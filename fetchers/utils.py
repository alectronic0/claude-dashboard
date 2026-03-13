import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

_FETCHERS_DIR = os.path.dirname(os.path.abspath(__file__))
DIR           = os.path.dirname(_FETCHERS_DIR)


def _load_config():
    path = os.path.join(DIR, "config.json")
    if not os.path.isfile(path):
        print(f"Error: config.json not found at {path}.\nCopy config.example.json to config.json and fill in your details.", file=sys.stderr)
        sys.exit(1)
    with open(path) as f:
        return json.load(f)


_cfg       = _load_config()
_gh_cfg    = _cfg.get("github", {})
_dash_cfg  = _cfg.get("dashboard", {})
_pd_cfg    = _cfg.get("pagerduty", {})
_slack_cfg = _cfg.get("slack", {})

PD_SCHEDULE_IDS = _pd_cfg.get("schedule_ids", [])
PD_MY_EMAIL     = _pd_cfg.get("my_email", "")
PD_BASE_URL     = _pd_cfg.get("base_url", "")

MY_USERNAME    = _gh_cfg.get("username", "")
ORG            = _gh_cfg.get("org", "")
TEAM_MEMBERS   = _gh_cfg.get("team_members", [])
PRIMARY_REPOS  = _gh_cfg.get("primary_repos", [])
MY_REPOS       = PRIMARY_REPOS
STAGING_BRANCH = _gh_cfg.get("staging_branch", "staging")
JIRA_PROJECT   = _cfg.get("jira", {}).get("project", "")
JIRA_BASE_URL  = _cfg.get("jira", {}).get("base_url", "")
ALL_TEAM       = set([MY_USERNAME] + TEAM_MEMBERS)

DASH_TITLE    = _dash_cfg.get("title", "Work Dashboard")
DASH_SUBTITLE = _dash_cfg.get("subtitle", "")

SLACK_BASE_URL        = _slack_cfg.get("base_url", "")
DEPLOY_FAVICON_DOMAIN = _cfg.get("deploy", {}).get("favicon_domain", "")
CONFIG_REPOS          = _cfg.get("config_repos", {})
TEAM_CONFIG           = _cfg.get("team", [])

# Fields fetched from search (lightweight — returned by Search API)
SEARCH_FIELDS = "number,title,url,isDraft,repository,author,labels,updatedAt"
# Fields fetched per-PR for enrichment (CI, reviews, branch info)
ENRICH_FIELDS = "number,title,url,isDraft,author,labels,updatedAt,baseRefName,headRefName,reviews,reviewRequests,statusCheckRollup,reviewDecision,body"
# Fields for non-team repo PR listing (no enrichment needed)
LIST_FIELDS   = "number,title,url,isDraft,author,labels,updatedAt,baseRefName"

# Safe inter-call delay to avoid secondary rate limit burst detection.
CALL_DELAY = 0.5  # seconds between API calls

MY_BRANCHES_PER_REPO = 20

GCAL_CREDS_DIR = os.path.expanduser("~/.google_workspace_mcp/credentials")


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
