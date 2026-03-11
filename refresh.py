#!/usr/bin/env python3
"""
Dashboard data refresh script.
Fetches GitHub PRs, Jira tickets, and Claude filesystem data.
Writes separate cache files then merges into dashboard-data.js.

Usage:
  python3 refresh.py             # full refresh (all sources)
  python3 refresh.py --github    # GitHub PRs only
  python3 refresh.py --jira      # Jira tickets only
  python3 refresh.py --local     # Plans + Claude filesystem only

GitHub rate limits:
  REST core:  5,000 req/hr   — gh api, gh pr list/view
  Search:        30 req/min  — gh search prs / gh api search/issues  ← tightest
  GraphQL:    5,000 req/hr   — gh pr list --json (enriched fields)
  Secondary:  undocumented burst detection — avoid >1 req/s sustained

Search strategy (minimises Search API calls):
  - fetch_all_open_prs:   2 searches (team open + assigned open, merged client-side)
  - fetch_all_merged_prs: 1 search   (mine + team, last 7 days)
  Total: 3 Search calls per full run (was 10).

  NOTE: `gh search prs` mangles raw author: qualifiers in positional args, treating
  them as text rather than GitHub search qualifiers and wrapping them in quotes.
  Use `gh api search/issues?q=...` directly to pass arbitrary query strings.
"""

import argparse
import subprocess
import json
import re
import sys
import os
import time
import urllib.request
import urllib.parse
import base64
import ssl
from datetime import datetime, timezone, timedelta

DIR          = os.path.dirname(os.path.abspath(__file__))
OUTPUT       = os.path.join(DIR, "dashboard-data.js")
CACHE_GITHUB = os.path.join(DIR, "cache-github.js")
CACHE_JIRA   = os.path.join(DIR, "cache-jira.js")
CACHE_LOCAL  = os.path.join(DIR, "cache-local.js")


def _load_config():
    path = os.path.join(DIR, "config.json")
    if not os.path.isfile(path):
        print(f"Error: config.json not found at {path}.\nCopy config.example.json to config.json and fill in your details.", file=sys.stderr)
        sys.exit(1)
    with open(path) as f:
        return json.load(f)


_cfg           = _load_config()
_gh_cfg        = _cfg.get("github", {})
_dash_cfg      = _cfg.get("dashboard", {})

MY_USERNAME    = _gh_cfg.get("username", "")
ORG            = _gh_cfg.get("org", "")
TEAM_MEMBERS   = _gh_cfg.get("team_members", [])
PRIMARY_REPOS  = _gh_cfg.get("primary_repos", [])
MY_REPOS       = PRIMARY_REPOS
STAGING_BRANCH = _gh_cfg.get("staging_branch", "staging")
JIRA_PROJECT   = _cfg.get("jira", {}).get("project", "")
ALL_TEAM       = set([MY_USERNAME] + TEAM_MEMBERS)

# Fields fetched from search (lightweight — returned by Search API)
SEARCH_FIELDS = "number,title,url,isDraft,repository,author,labels,updatedAt"
# Fields fetched per-PR for enrichment (CI, reviews, branch info)
ENRICH_FIELDS = "number,title,url,isDraft,author,labels,updatedAt,baseRefName,headRefName,reviews,statusCheckRollup,reviewDecision,body"
# Fields for non-team repo PR listing (no enrichment needed)
LIST_FIELDS   = "number,title,url,isDraft,author,labels,updatedAt,baseRefName"

# Safe inter-call delay to avoid secondary rate limit burst detection.
CALL_DELAY = 0.5  # seconds between API calls

# Stale branch detection thresholds (for PRIMARY_REPOS).
STALE_BRANCH_DAYS      = 30   # branches with no commit in N days are flagged
STALE_BRANCHES_PER_REPO = 10  # max stale branches to check per repo


# ── Search query helpers ───────────────────────────────────────────────────────

def _team_author_query():
    """
    Space-separated author: qualifiers for all team members (including me).

    GitHub search implicitly ORs multiple same-type qualifiers:
    'author:a author:b' = PRs by a OR b.
    """
    return " ".join(f"author:{a}" for a in [MY_USERNAME] + TEAM_MEMBERS)


def _gh_search(query, max_results=300, progress=None):
    """
    Call the GitHub Search API directly via `gh api search/issues?q=...`.

    Unlike `gh search prs [<query>]`, this passes the query string verbatim
    to the API without any CLI-side mangling (quoting, parenthesising, etc.).
    Handles pagination transparently. Returns items normalised to the same
    shape as `gh search prs --json <SEARCH_FIELDS>`.
    """
    all_items = []
    page      = 1
    per_page  = 100  # GitHub Search API max

    while len(all_items) < max_results:
        encoded = urllib.parse.quote(f"is:pr {query}", safe="")
        result  = run_gh(
            ["api", f"search/issues?q={encoded}&per_page={per_page}&page={page}"],
            default={}, silent=True, progress=progress,
        )
        if not isinstance(result, dict):
            break
        batch = result.get("items", [])
        if not batch:
            break
        all_items.extend(batch)
        if len(batch) < per_page or len(all_items) >= result.get("total_count", 0):
            break
        page += 1
        time.sleep(CALL_DELAY)

    return [_normalise_search_item(i) for i in all_items[:max_results]]


def _normalise_search_item(item):
    """
    Map a GitHub Search API issue/PR item to the shape gh search prs --json
    produces so the rest of the code can treat them identically.
    """
    repo_url  = item.get("repository_url", "")  # ".../repos/org/name"
    parts     = repo_url.rstrip("/").split("/")
    repo_name = parts[-1] if parts else ""
    org_name  = parts[-2] if len(parts) >= 2 else ""
    return {
        "number":     item.get("number"),
        "title":      item.get("title", ""),
        "url":        item.get("html_url", ""),
        "isDraft":    item.get("draft", False),
        "repository": {"name": repo_name, "nameWithOwner": f"{org_name}/{repo_name}"},
        "author":     {"login": (item.get("user") or {}).get("login", "")},
        "labels":     [{"name": l.get("name", "")} for l in (item.get("labels") or [])],
        "updatedAt":  item.get("updated_at", ""),
    }


# ── Progress bar ───────────────────────────────────────────────────────────────

class Progress:
    """
    In-place progress bar for TTY output; line-per-step fallback otherwise.

    Usage:
        p = Progress(total=32)
        p.add(10)           # extend total after discovering more work
        p.step("label")     # advance by 1 and update label
        p.message("info")   # print a message without losing bar position
        p.finish()          # mark complete, print newline (TTY only)
    """

    def __init__(self, total: int = 0, width: int = 40):
        self.total = total
        self.done  = 0
        self.label = ""
        self.width = width
        self._tty  = sys.stderr.isatty()

    def add(self, n: int) -> None:
        """Reserve n more steps (extend total after discovering more work)."""
        self.total += n

    def step(self, label: str = "") -> None:
        """Advance by one step and update the displayed label."""
        self.done  = min(self.done + 1, max(self.total, 1))
        self.label = label
        self._render()

    def message(self, msg: str) -> None:
        """
        Print a message to stderr without corrupting the progress bar.
        In TTY mode: clears the current bar line, prints the message on its
        own line, then re-renders the bar below it.
        """
        if self._tty:
            print(f"\r{' ' * 80}\r{msg}", file=sys.stderr)
            self._render()
        else:
            print(msg, file=sys.stderr)

    def _render(self) -> None:
        total  = max(self.total, 1)
        filled = int(self.width * self.done / total)
        arrow  = ">" if filled < self.width else ""
        gap    = self.width - filled - len(arrow)
        bar    = "=" * filled + arrow + " " * gap
        line   = f"[{bar}] {self.done}/{self.total}  {self.label}"
        if self._tty:
            try:
                cols = os.get_terminal_size().columns
                line = line[: cols - 1]
            except Exception:
                pass
            print(f"\r{line}", end="", flush=True, file=sys.stderr)
        else:
            print(f"  [{self.done}/{self.total}] {self.label}", file=sys.stderr)

    def finish(self) -> None:
        """Fill bar to 100% and print a trailing newline (TTY only)."""
        if self._tty:
            self.done = self.total
            self._render()
            print(file=sys.stderr)


# ── GitHub helpers ─────────────────────────────────────────────────────────────

def run_gh(args, default=None, max_retries=5, silent=False, progress=None):
    """
    Run a gh CLI command, returning parsed JSON or `default` on failure.

    Handles GitHub rate limits with patient exponential backoff:
      attempt 1: wait 30s
      attempt 2: wait 60s
      attempt 3: wait 120s
      attempt 4: wait 240s
    Messages route through progress.message() when available so they don't
    corrupt the progress bar.
    """
    if default is None:
        default = []

    def _msg(text):
        if progress:
            progress.message(f"  {text}")
        elif not silent:
            print(f"  {text}", file=sys.stderr)

    for attempt in range(max_retries):
        try:
            result = subprocess.run(
                ["gh"] + args,
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode == 0:
                return json.loads(result.stdout)

            stderr = result.stderr.strip()
            if "rate limit" in stderr.lower():
                if attempt < max_retries - 1:
                    wait = 30 * (2 ** attempt)  # 30 → 60 → 120 → 240 → 480s
                    _msg(f"⏳ Rate limited — waiting {wait}s (retry {attempt + 1}/{max_retries - 1})...")
                    time.sleep(wait)
                    continue
            if not silent:
                _msg(f"Warning: {stderr[:120]}")
            return default

        except subprocess.TimeoutExpired:
            if not silent:
                _msg("Warning: gh command timed out")
            return default
        except Exception as e:
            if not silent:
                _msg(f"Error: {e}")
            return default

    if not silent:
        _msg("Warning: rate limit retries exhausted — skipping")
    return default


def check_rate_limit(progress=None):
    """
    Fetch and display current GitHub rate limit status.
    Warns if Search API is nearly exhausted (30/min — the tightest limit).
    """
    data = run_gh(["api", "rate_limit"], default={}, silent=True, progress=progress)
    if not isinstance(data, dict):
        return

    def _msg(text):
        if progress:
            progress.message(text)
        else:
            print(text, file=sys.stderr)

    resources = data.get("resources", {})
    for label, key in [("REST", "core"), ("Search", "search"), ("GraphQL", "graphql")]:
        info      = resources.get(key, {})
        remaining = info.get("remaining", "?")
        limit     = info.get("limit", "?")
        reset_ts  = info.get("reset", 0)
        mins      = max(0, int((reset_ts - time.time()) / 60)) if reset_ts else 0
        _msg(f"  GitHub {label}: {remaining}/{limit} remaining (resets in {mins}m)")

    search = resources.get("search", {})
    if isinstance(search.get("remaining"), int) and search["remaining"] < 5:
        _msg("  ⚠️  Search limit critically low — fetches may need to wait")


def _check_details(pr):
    """Extract individual check name+state from statusCheckRollup."""
    result = []
    for c in pr.get("statusCheckRollup") or []:
        typename = c.get("__typename", "")
        if typename == "CheckRun":
            name       = c.get("name") or "unknown"
            conclusion = (c.get("conclusion") or "").upper()
            status     = (c.get("status") or "").upper()
            if conclusion in ("FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"):
                state = "failing"
            elif conclusion in ("SUCCESS", "NEUTRAL", "SKIPPED"):
                state = "passing"
            elif status in ("IN_PROGRESS", "QUEUED", "REQUESTED", "WAITING", "PENDING"):
                state = "pending"
            else:
                state = "passing"
        else:
            name = c.get("context") or "unknown"
            raw  = (c.get("state") or "").upper()
            if raw in ("FAILURE", "ERROR"):
                state = "failing"
            elif raw == "PENDING":
                state = "pending"
            else:
                state = "passing"
        result.append({"name": name, "state": state})
    return result


def _ci_status(checks):
    """Overall CI status from check details list."""
    if not checks:
        return ""
    states = {c["state"] for c in checks}
    if "failing" in states:
        return "failing"
    if "pending" in states:
        return "pending"
    if all(s == "passing" for s in states):
        return "passing"
    return ""


def _approval_count(pr):
    reviews = pr.get("reviews") or []
    latest  = {}
    for r in reviews:
        author = (r.get("author") or {}).get("login", "")
        if author:
            latest[author] = r.get("state", "")
    return sum(1 for s in latest.values() if s == "APPROVED")


def _pr_repo_name(pr):
    return (pr.get("repository") or {}).get("name", "") or pr.get("repoName", "")


_repo_archived_cache = {}


def is_repo_archived(repo_name, progress=None):
    if not repo_name or repo_name in _repo_archived_cache:
        return _repo_archived_cache.get(repo_name, False)
    data     = run_gh(["api", f"repos/{ORG}/{repo_name}"], default={}, silent=True, progress=progress)
    archived = data.get("archived", False) if isinstance(data, dict) else False
    _repo_archived_cache[repo_name] = archived
    return archived


# ── Fetch functions ────────────────────────────────────────────────────────────

def fetch_required_approvals(progress=None):
    """Fetch required approval count from branch protection for primary repos."""
    result = {}
    for repo in PRIMARY_REPOS:
        if progress:
            progress.step(f"Branch protection: {repo}")
        data = run_gh(
            ["api", f"repos/{ORG}/{repo}/branches/main/protection"],
            default={}, silent=True, progress=progress,
        )
        if not data:
            data = run_gh(
                ["api", f"repos/{ORG}/{repo}/branches/master/protection"],
                default={}, silent=True, progress=progress,
            )
        count = (
            (data.get("required_pull_request_reviews") or {})
            .get("required_approving_review_count", 1)
        )
        result[repo] = count
        time.sleep(CALL_DELAY)
    return result


def fetch_staging_merged(progress=None):
    """Fetch head branch names of PRs recently merged to staging, per repo."""
    result = {}
    for repo in MY_REPOS:
        if progress:
            progress.step(f"Staging-merged branches: {repo}")
        prs = run_gh([
            "pr", "list",
            "--repo", f"{ORG}/{repo}",
            "--base", STAGING_BRANCH,
            "--state", "merged",
            "--json", "headRefName",
            "--limit", "200",
        ], silent=True, progress=progress)
        result[repo] = {pr.get("headRefName", "") for pr in prs}
        time.sleep(CALL_DELAY)
    return result


def fetch_all_open_prs(progress=None):
    """
    Fetch all open PRs we care about in two direct Search API calls.

    Uses _gh_search (gh api search/issues) to pass raw GitHub search qualifiers
    without the CLI mangling them.

      Call 1: all open PRs by team members (author: qualifiers, implicitly OR'd)
      Call 2: all open PRs with me as a requested reviewer

    Returns a deduplicated flat list. Caller splits by author.
    """
    if progress:
        progress.step("Fetching all open team PRs...")
    else:
        print("  Fetching all open team PRs...", file=sys.stderr)

    team_open = _gh_search(
        f"is:open org:{ORG} {_team_author_query()}",
        max_results=300, progress=progress,
    )
    time.sleep(CALL_DELAY)

    if progress:
        progress.step("Fetching open PRs assigned to me for review...")
    else:
        print("  Fetching open PRs assigned to me for review...", file=sys.stderr)

    assigned = _gh_search(
        f"is:open review-requested:{MY_USERNAME}",
        max_results=200, progress=progress,
    )

    # Deduplicate — a team member's PR might also be assigned to me for review
    seen  = {(p["number"], _pr_repo_name(p)) for p in team_open}
    extra = [p for p in assigned if (p["number"], _pr_repo_name(p)) not in seen]
    return team_open + extra


def fetch_all_merged_prs(progress=None):
    """
    One direct Search API call for all merged PRs from me and team (last 7 days).

    Caller filters to my_merged_prs by author.
    """
    if progress:
        progress.step("Fetching all recently merged PRs (team)...")
    else:
        print("  Fetching all recently merged PRs (team)...", file=sys.stderr)

    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).strftime('%Y-%m-%d')
    return _gh_search(
        f"is:merged org:{ORG} merged:>={cutoff} {_team_author_query()}",
        max_results=100, progress=progress,
    )


def enrich_all_prs(prs_raw, required_approvals, staging_merged, progress=None):
    """
    Fetch full PR details for every PR in the list.

    For each PR:
      1. gh pr view  — CI status, reviews, headRefName         (1 GraphQL call)
      2. gh api compare main/master...head  — behind main      (1 REST call)
      3. gh api compare staging...head      — ahead of staging  (1 REST call)

    Extends the progress total dynamically since count is unknown until
    fetch_all_open_prs() returns.
    """
    if progress:
        progress.add(len(prs_raw) * 3)  # enrich + compare-main + compare-staging per PR

    enriched = []
    for pr in prs_raw:
        repo   = _pr_repo_name(pr)
        number = pr["number"]

        # ── Step 1: enrich with CI / review / branch data ─────────────────
        if progress:
            progress.step(f"Enriching: {repo} #{number}")
        full = run_gh([
            "pr", "view", str(number),
            "--repo", f"{ORG}/{repo}",
            "--json", ENRICH_FIELDS,
        ], default={}, progress=progress)
        time.sleep(CALL_DELAY)

        if not full:
            pr["repoName"]          = repo
            pr["checks"]            = []
            pr["ciStatus"]          = ""
            pr["approvalCount"]     = 0
            pr["requiredApprovals"] = required_approvals.get(repo, 1)
            pr["mergedToStaging"]   = False
            pr["behindBy"]          = 0
            pr["aheadOfStaging"]    = 0
            enriched.append(pr)
            # Consume the two compare steps even though we're skipping
            if progress:
                progress.step(f"Compare main: {repo} #{number} (skipped)")
                progress.step(f"Compare staging: {repo} #{number} (skipped)")
            continue

        checks = _check_details(full)
        full["repoName"]          = repo
        full["checks"]            = [c for c in checks if c["state"] != "passing"]
        full["ciStatus"]          = _ci_status(checks)
        full["approvalCount"]     = _approval_count(full)
        full["requiredApprovals"] = required_approvals.get(repo, 1)
        full["mergedToStaging"]   = (
            full.get("headRefName", "") in staging_merged.get(repo, set())
        )

        head_ref = full.get("headRefName", "")

        # ── Step 2: how far behind main/master ────────────────────────────
        if progress:
            progress.step(f"Compare main: {repo} #{number}")
        behind_by = 0
        if head_ref:
            cmp = run_gh(
                ["api", f"repos/{ORG}/{repo}/compare/main...{head_ref}"],
                default={}, silent=True, progress=progress,
            )
            if not isinstance(cmp, dict) or "behind_by" not in cmp:
                cmp = run_gh(
                    ["api", f"repos/{ORG}/{repo}/compare/master...{head_ref}"],
                    default={}, silent=True, progress=progress,
                )
            behind_by = cmp.get("behind_by", 0) if isinstance(cmp, dict) else 0
            time.sleep(CALL_DELAY)
        full["behindBy"] = behind_by

        # ── Step 3: how far ahead of staging ──────────────────────────────
        # ahead_by > 0 means the branch has commits not yet in staging.
        if progress:
            progress.step(f"Compare staging: {repo} #{number}")
        ahead_of_staging = 0
        if head_ref:
            cmp = run_gh(
                ["api", f"repos/{ORG}/{repo}/compare/{STAGING_BRANCH}...{head_ref}"],
                default={}, silent=True, progress=progress,
            )
            ahead_of_staging = cmp.get("ahead_by", 0) if isinstance(cmp, dict) else 0
            time.sleep(CALL_DELAY)
        full["aheadOfStaging"] = ahead_of_staging

        enriched.append(full)

    return enriched


def fetch_stale_branches(open_head_refs_by_repo, progress=None):
    """
    Detect stale branches in PRIMARY_REPOS that should be candidates for pruning.

    A branch is a pruning candidate if ALL of these are true:
      - It's not a default/protected branch (main, master, staging, develop)
      - It has no currently open PR pointing to it
      - Its last commit is older than STALE_BRANCH_DAYS days

    For each PRIMARY_REPO:
      1. gh api branches  — list all branches (1 REST call per repo)
      2. gh api commits   — get last commit date for candidates (1 REST call each,
                            capped at STALE_BRANCHES_PER_REPO per repo)

    Extends the progress total dynamically once we know how many candidates there are.
    """
    DEFAULT_BRANCHES = {"main", "master", STAGING_BRANCH, "develop", "development"}
    stale_cutoff     = datetime.now(timezone.utc) - timedelta(days=STALE_BRANCH_DAYS)
    result           = []

    for repo in PRIMARY_REPOS:
        if progress:
            progress.step(f"Scanning branches: {repo}")

        # List all branches (up to 100; primary repos rarely exceed this)
        branches = run_gh(
            ["api", f"repos/{ORG}/{repo}/branches?per_page=100"],
            default=[], silent=True, progress=progress,
        )
        if not isinstance(branches, list):
            continue
        time.sleep(CALL_DELAY)

        open_refs = open_head_refs_by_repo.get(repo, set())

        # Filter to branches without an open PR and not a default/protected branch
        candidates = [
            b["name"] for b in branches
            if b.get("name") not in DEFAULT_BRANCHES
            and b.get("name") not in open_refs
            and not b.get("protected", False)
        ]

        # Extend progress for the per-branch commit checks we're about to do
        n_to_check = min(len(candidates), STALE_BRANCHES_PER_REPO)
        if progress:
            progress.add(n_to_check)

        for branch_name in candidates[:STALE_BRANCHES_PER_REPO]:
            if progress:
                progress.step(f"Branch age: {repo}/{branch_name[:30]}")

            commits = run_gh(
                ["api", f"repos/{ORG}/{repo}/commits?sha={branch_name}&per_page=1"],
                default=[], silent=True, progress=progress,
            )
            time.sleep(CALL_DELAY)

            if not isinstance(commits, list) or not commits:
                continue

            commit_info   = commits[0].get("commit", {})
            raw_date      = (
                (commit_info.get("committer") or {}).get("date")
                or (commit_info.get("author") or {}).get("date", "")
            )
            if not raw_date:
                continue

            try:
                commit_dt = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
            except Exception:
                continue

            if commit_dt >= stale_cutoff:
                continue  # recently active — not stale

            days_old    = (datetime.now(timezone.utc) - commit_dt).days
            author_name = (commit_info.get("author") or {}).get("name", "")
            author_login = (commits[0].get("author") or {}).get("login", "")
            result.append({
                "repo":         repo,
                "branch":       branch_name,
                "lastCommitAt": raw_date,
                "daysOld":      days_old,
                "author":       author_name,
                "authorLogin":  author_login,
            })

    return result


def fetch_repo_prs(progress=None):
    """Fetch open PRs in primary repos authored by non-team members."""
    repo_prs = []
    for repo in PRIMARY_REPOS:
        if progress:
            progress.step(f"Non-team PRs: {repo}")
        prs = run_gh([
            "pr", "list",
            "--repo", f"{ORG}/{repo}",
            "--state=open",
            "--json", LIST_FIELDS,
            "--limit", "30",
        ], progress=progress)
        for pr in prs:
            author = pr.get("author", {}).get("login", "")
            if author not in ALL_TEAM:
                pr["repoName"] = repo
                repo_prs.append(pr)
    return repo_prs


# ── Local data ─────────────────────────────────────────────────────────────────

def _parse_skill_description(filepath):
    """Extract first description line from SKILL.md YAML frontmatter."""
    try:
        with open(filepath) as f:
            lines = f.read().splitlines()
        in_fm = in_desc = False
        for line in lines:
            if line.strip() == "---":
                if not in_fm:
                    in_fm = True
                    continue
                break
            if not in_fm:
                continue
            if line.startswith("description:"):
                rest = line.split(":", 1)[1].strip()
                if rest and rest != "|":
                    return rest.strip("'\"")
                in_desc = True
                continue
            if in_desc and line.startswith(" ") and line.strip():
                return line.strip()
    except Exception:
        pass
    return ""


def fetch_claude_data(progress=None):
    """Read Claude filesystem: skills, agents, hooks, MCP server names."""
    if progress:
        progress.step("Reading Claude filesystem...")
    else:
        print("  Reading Claude filesystem...", file=sys.stderr)

    claude_dir = os.path.expanduser("~/.claude")
    data = {"skills": [], "agents": [], "hooks": {}, "mcpServers": []}

    skills_dir = os.path.join(claude_dir, "skills")
    if os.path.isdir(skills_dir):
        for name in sorted(os.listdir(skills_dir)):
            skill_file = os.path.join(skills_dir, name, "SKILL.md")
            if os.path.isfile(skill_file):
                data["skills"].append({
                    "name":        name,
                    "description": _parse_skill_description(skill_file),
                })

    agents_dir = os.path.join(claude_dir, "agents")
    if os.path.isdir(agents_dir):
        for f in sorted(os.listdir(agents_dir)):
            if f.endswith(".md"):
                data["agents"].append({"name": f[:-3]})

    settings_path = os.path.join(claude_dir, "settings.json")
    if os.path.isfile(settings_path):
        try:
            with open(settings_path) as f:
                settings = json.load(f)
            data["hooks"] = {k: len(v) for k, v in settings.get("hooks", {}).items()}
        except Exception as e:
            print(f"  Warning: could not read settings.json — {e}", file=sys.stderr)

    claude_json = os.path.expanduser("~/.claude.json")
    if os.path.isfile(claude_json):
        try:
            with open(claude_json) as f:
                config = json.load(f)
            data["mcpServers"] = sorted(config.get("mcpServers", {}).keys())
        except Exception as e:
            print(f"  Warning: could not read .claude.json — {e}", file=sys.stderr)

    return data


def parse_internal_priorities():
    """Parse internal priority overrides from active-work.md."""
    active_work_path = os.path.expanduser("~/.claude/memory/active-work.md")
    result = {}
    try:
        with open(active_work_path) as f:
            content = f.read()
        in_section = False
        for line in content.splitlines():
            if line.strip() == "## Internal Priority Overrides":
                in_section = True
                continue
            if in_section and line.startswith("## "):
                break
            if not in_section or not line.startswith("|"):
                continue
            if line.startswith("|---") or "Ticket" in line.split("|")[1:2]:
                continue
            parts = [p.strip() for p in line.split("|")]
            parts = [p for p in parts if p]
            if len(parts) >= 2:
                result[parts[0]] = parts[1]
    except Exception as e:
        print(f"  Warning: could not parse internal priorities — {e}", file=sys.stderr)
    return result


def parse_next_actions():
    """Parse next actions from the Dashboard — Work table in active-work.md."""
    active_work_path = os.path.expanduser("~/.claude/memory/active-work.md")
    result = {}
    try:
        with open(active_work_path) as f:
            content = f.read()
        in_work = False
        for line in content.splitlines():
            if line.strip() == "## Dashboard — Work":
                in_work = True
                continue
            if in_work and line.startswith("## "):
                break
            if not in_work or not line.startswith("|"):
                continue
            if line.startswith("|---") or "Ticket" in line.split("|")[1:2]:
                continue
            parts = [p.strip() for p in line.split("|")]
            parts = [p for p in parts if p != ""]
            if len(parts) < 5:
                continue
            keys        = re.findall(rf'{re.escape(JIRA_PROJECT)}-\d+', parts[1]) if JIRA_PROJECT else []
            next_action = re.sub(r'\*\*([^*]+)\*\*', r'\1', parts[4])
            for key in keys:
                result[key] = next_action
    except Exception as e:
        print(f"  Warning: could not parse active-work.md next actions — {e}", file=sys.stderr)
    return result


def fetch_plans(progress=None):
    """Read plan files and match with Plans table from active-work.md."""
    if progress:
        progress.step("Reading plans...")
    else:
        print("  Reading plans...", file=sys.stderr)

    plans_dir        = os.path.expanduser("~/.claude/plans")
    active_work_path = os.path.expanduser("~/.claude/memory/active-work.md")

    plan_meta = {}
    try:
        with open(active_work_path) as f:
            content = f.read()
        in_plans = False
        for line in content.splitlines():
            if line.startswith("## Plans"):
                in_plans = True
                continue
            if in_plans and line.startswith("## "):
                break
            if not in_plans or not line.startswith("|"):
                continue
            if line.startswith("|---") or "Plan" in line.split("|")[1:2]:
                continue
            parts = [p.strip() for p in line.split("|") if p.strip()]
            if len(parts) < 3:
                continue
            m = re.match(r'\[([^\]]+)\]\(([^)]+)\)', parts[0])
            if not m:
                continue
            name     = m.group(1)
            filename = os.path.basename(m.group(2))
            what     = parts[1]
            kickoff  = parts[2].strip('"').strip("'")
            plan_meta[filename] = {"name": name, "what": what, "kickoff": kickoff}
    except Exception as e:
        print(f"  Warning: could not parse active-work.md plans — {e}", file=sys.stderr)

    plans = []
    if os.path.isdir(plans_dir):
        for f in sorted(os.listdir(plans_dir)):
            if not f.endswith(".md"):
                continue
            meta         = plan_meta.get(f, {})
            default_name = f[:-3].replace("-", " ").title()
            name         = meta.get("name", default_name)
            plans.append({
                "filename":     f,
                "name":         name,
                "what":         meta.get("what", ""),
                "kickoff":      meta.get("kickoff", f"Let's look into {name}, what can you tell me about this before we start?"),
                "inPlansTable": f in plan_meta,
            })
    return plans


def fetch_jira_tickets(progress=None):
    """Fetch assigned tickets from Jira REST API using config + env var credentials."""
    jira_url   = os.environ.get("JIRA_URL", "").rstrip("/")
    username   = os.environ.get("JIRA_USERNAME", "")
    token      = os.environ.get("JIRA_API_TOKEN", "")
    ssl_verify = os.environ.get("JIRA_SSL_VERIFY", "true").lower() not in ("false", "0", "no")

    if not all([jira_url, username, token]):
        print("  Warning: JIRA_URL / JIRA_USERNAME / JIRA_API_TOKEN not set — skipping Jira", file=sys.stderr)
        return []

    if not JIRA_PROJECT:
        print("  Warning: jira.project not set in config.json — skipping Jira", file=sys.stderr)
        return []
    label = f"Fetching Jira tickets ({JIRA_PROJECT}, assigned to me, not Done)..."
    if progress:
        progress.step(label)
    else:
        print(f"  {label}", file=sys.stderr)

    url  = f"{jira_url}/rest/api/3/search/jql"
    body = json.dumps({
        "jql":        f"project = {JIRA_PROJECT} AND assignee = currentUser() AND statusCategory != Done ORDER BY priority ASC, updated DESC",
        "maxResults": 50,
        "fields":     ["key", "summary", "status", "priority", "issuetype", "updated", "labels", "parent", "duedate", "customfield_10020", "comment"],
    }).encode()

    creds = base64.b64encode(f"{username}:{token}".encode()).decode()
    req   = urllib.request.Request(url, data=body, headers={
        "Authorization": f"Basic {creds}",
        "Accept":        "application/json",
        "Content-Type":  "application/json",
    }, method="POST")

    ctx = ssl.create_default_context()
    if not ssl_verify:
        ctx.check_hostname = False
        ctx.verify_mode    = ssl.CERT_NONE

    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        print(f"  Warning: Jira fetch failed — {e}", file=sys.stderr)
        return []

    tickets = []
    for issue in data.get("issues", []):
        fields        = issue.get("fields", {})
        status        = fields.get("status", {})
        priority      = fields.get("priority") or {}
        parent        = fields.get("parent") or {}
        sprint_list   = fields.get("customfield_10020") or []
        sprint        = sprint_list[-1].get("name", "") if sprint_list else ""
        comment_data  = fields.get("comment") or {}
        comment_count = comment_data.get("total", 0) if isinstance(comment_data, dict) else 0
        tickets.append({
            "key":            issue["key"],
            "summary":        fields.get("summary", ""),
            "status":         status.get("name", ""),
            "statusCategory": status.get("statusCategory", {}).get("name", ""),
            "priority":       priority.get("name", ""),
            "issueType":      (fields.get("issuetype") or {}).get("name", ""),
            "updated":        fields.get("updated", ""),
            "dueDate":        fields.get("duedate", ""),
            "labels":         fields.get("labels", []),
            "parentKey":      parent.get("key", ""),
            "parentSummary":  (parent.get("fields") or {}).get("summary", ""),
            "sprint":         sprint,
            "commentCount":   comment_count,
            "url":            f"{jira_url}/browse/{issue['key']}",
        })
    return tickets


# ── Cache helpers ──────────────────────────────────────────────────────────────

def _load_cache(path):
    if not os.path.isfile(path):
        return {}
    try:
        with open(path) as f:
            content = f.read()
        m = re.search(r'window\.\w+ = ({.*});\s*$', content, re.DOTALL)
        if m:
            return json.loads(m.group(1))
    except Exception:
        pass
    return {}


def _write_cache(path, var_name, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(f"// Generated by refresh.py at {data['generatedAt']}\n")
        f.write(f"window.{var_name} = {json.dumps(data, indent=2)};\n")


def _write_merged():
    github = _load_cache(CACHE_GITHUB)
    jira   = _load_cache(CACHE_JIRA)
    local  = _load_cache(CACHE_LOCAL)
    merged = {**github, **jira, **local,
              "generatedAt": datetime.now(timezone.utc).isoformat()}
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w") as f:
        f.write("// Generated by refresh.py — merged from caches\n")
        f.write(f"// Do not edit manually — regenerate: python3 {os.path.basename(__file__)}\n")
        f.write(f"window.DASHBOARD_DATA = {json.dumps(merged, indent=2)};\n")


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Refresh dashboard data caches.")
    parser.add_argument("--github", action="store_true", help="GitHub PRs only")
    parser.add_argument("--jira",   action="store_true", help="Jira tickets only")
    parser.add_argument("--local",  action="store_true", help="Plans + Claude filesystem only")
    args    = parser.parse_args()
    run_all = not any([args.github, args.jira, args.local])

    # Pre-calculate known step counts.  Enrich + compare steps for my open PRs
    # are unknown upfront — added dynamically via progress.add() inside
    # enrich_my_prs() once we know how many PRs came back.
    #
    #   GitHub steps (fixed):
    #     1   check_rate_limit
    #     7   fetch_required_approvals   (one per PRIMARY_REPO)
    #    12   fetch_staging_merged       (one per MY_REPO)
    #     1   fetch_all_open_prs         (single search)
    #     1   fetch_all_merged_prs       (single search)
    #   +N×3  enrich_all_prs            (enrich + compare-main + compare-staging per PR — added dynamically)
    #     7   fetch_repo_prs             (one per PRIMARY_REPO)
    #   Jira: 1
    #   Local: 2

    github_fixed = (
        1                    # check_rate_limit
        + len(PRIMARY_REPOS) # fetch_required_approvals
        + len(MY_REPOS)      # fetch_staging_merged
        + 2                  # fetch_all_open_prs  (team + assigned)
        + 1                  # fetch_all_merged_prs
        + len(PRIMARY_REPOS) # fetch_stale_branches (listing step; commit checks added dynamically)
        + len(PRIMARY_REPOS) # fetch_repo_prs
    )
    jira_steps   = 1
    local_steps  = 2

    total = 0
    if run_all or args.github:
        total += github_fixed
    if run_all or args.jira:
        total += jira_steps
    if run_all or args.local:
        total += local_steps

    progress = Progress(total=total)

    if run_all or args.github:
        print("Refreshing GitHub PR data...", file=sys.stderr)

        check_rate_limit(progress)
        progress.step("Checked rate limits")

        required_approvals = fetch_required_approvals(progress)
        staging_merged     = fetch_staging_merged(progress)

        # Single search for all open PRs — split client-side by author
        all_open = fetch_all_open_prs(progress)
        my_prs_raw   = [p for p in all_open if (p.get("author") or {}).get("login") == MY_USERNAME]
        team_prs_raw = [p for p in all_open if (p.get("author") or {}).get("login") in TEAM_MEMBERS]
        assigned_raw = [p for p in all_open if (p.get("author") or {}).get("login") not in ALL_TEAM]

        # Single search for all merged PRs — filter mine for the dashboard
        all_merged    = fetch_all_merged_prs(progress)
        my_merged_prs = [p for p in all_merged if (p.get("author") or {}).get("login") == MY_USERNAME]
        for p in my_merged_prs:
            p["isMerged"] = True
            p["repoName"] = (p.get("repository") or {}).get("name", "")

        # Enrich all open PRs (mine + team + assigned) with CI/review/branch/behind data.
        # We have plenty of REST/GraphQL headroom (5000/hr); Search was the bottleneck.
        all_open_prs = my_prs_raw + team_prs_raw + assigned_raw
        enriched     = enrich_all_prs(all_open_prs, required_approvals, staging_merged, progress)

        # Re-split the enriched results by author for the dashboard's data shape.
        # Archive check is cached after first hit per repo — negligible extra calls.
        my_prs       = [p for p in enriched if (p.get("author") or {}).get("login") == MY_USERNAME]
        team_prs     = [p for p in enriched if (p.get("author") or {}).get("login") in TEAM_MEMBERS
                        and not is_repo_archived(_pr_repo_name(p), progress)]
        assigned_prs = [p for p in enriched if (p.get("author") or {}).get("login") not in ALL_TEAM
                        and not is_repo_archived(_pr_repo_name(p), progress)]

        # Build set of head refs per repo from enriched PRs — used by stale branch
        # detection to skip branches that already have an open PR.
        open_head_refs: dict[str, set] = {}
        for pr in enriched:
            repo = _pr_repo_name(pr)
            head = pr.get("headRefName", "")
            if repo and head:
                open_head_refs.setdefault(repo, set()).add(head)

        stale_branches = fetch_stale_branches(open_head_refs, progress)
        repo_prs       = fetch_repo_prs(progress)

        github_data = {
            "generatedAt":   datetime.now(timezone.utc).isoformat(),
            "myPRs":         my_prs,
            "myMergedPRs":   my_merged_prs,
            "teamPRs":       team_prs,
            "repoPRs":       repo_prs,
            "assignedPRs":   assigned_prs,
            "staleBranches": stale_branches,
        }
        _write_cache(CACHE_GITHUB, "DASHBOARD_GITHUB", github_data)

        progress.message(f"  My PRs: {len(my_prs)}")
        progress.message(f"  Team PRs: {len(team_prs)}")
        progress.message(f"  Repo PRs (non-team): {len(repo_prs)}")
        progress.message(f"  Assigned to me: {len(assigned_prs)}")
        progress.message(f"  Stale branches: {len(stale_branches)}")

    if run_all or args.jira:
        print("Refreshing Jira data...", file=sys.stderr)
        jira_tickets = fetch_jira_tickets(progress)
        jira_data = {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "jiraTickets": jira_tickets,
        }
        progress.message(f"  Jira tickets: {len(jira_tickets)}")
        _write_cache(CACHE_JIRA, "DASHBOARD_JIRA", jira_data)

    if run_all or args.local:
        print("Refreshing local data...", file=sys.stderr)
        claude_data         = fetch_claude_data(progress)
        plans               = fetch_plans(progress)
        next_actions        = parse_next_actions()
        internal_priorities = parse_internal_priorities()
        local_data = {
            "generatedAt":        datetime.now(timezone.utc).isoformat(),
            "githubUsername":     MY_USERNAME,
            "dashboardTitle":     _dash_cfg.get("title", "Work Dashboard"),
            "dashboardSubtitle":  _dash_cfg.get("subtitle", ""),
            "claudeData":         claude_data,
            "plans":              plans,
            "nextActions":        next_actions,
            "internalPriorities": internal_priorities,
        }
        cd = claude_data
        progress.message(f"  Plans: {len(plans)}")
        progress.message(f"  Skills: {len(cd.get('skills', []))}  Agents: {len(cd.get('agents', []))}  MCP servers: {len(cd.get('mcpServers', []))}")
        _write_cache(CACHE_LOCAL, "DASHBOARD_LOCAL", local_data)

    progress.finish()
    print("Merging caches...", file=sys.stderr)
    _write_merged()
    print(f"\nDone — written to {OUTPUT}")
    print("Reload the dashboard in your browser to see updated data.")


if __name__ == "__main__":
    main()
