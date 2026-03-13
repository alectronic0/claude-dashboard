import sys
import time
from datetime import datetime, timezone, timedelta

from .utils import (
    run_gh, _gh_search, _team_author_query,
    MY_USERNAME, ORG, TEAM_MEMBERS, PRIMARY_REPOS, MY_REPOS, STAGING_BRANCH,
    ALL_TEAM, ENRICH_FIELDS, LIST_FIELDS, CALL_DELAY, MY_BRANCHES_PER_REPO,
)


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


def _my_review_status(pr):
    reviews = pr.get("reviews") or []
    my_latest = None
    for r in reviews:
        author = (r.get("author") or {}).get("login", "")
        state  = r.get("state", "")
        if author == MY_USERNAME and state and state != "PENDING":
            my_latest = state

    if my_latest == "APPROVED":           return "approved"
    if my_latest == "CHANGES_REQUESTED":  return "changes_requested"
    if my_latest == "COMMENTED":          return "commented"
    if my_latest == "DISMISSED":          return None

    requests = pr.get("reviewRequests") or []
    for req in requests:
        reviewer = req.get("requestedReviewer") or {}
        if reviewer.get("login") == MY_USERNAME:
            return "review_requested"
    return None


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
            pr["myReviewStatus"]    = None
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
        full["myReviewStatus"]    = _my_review_status(full)
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


def fetch_my_branches(open_head_refs_by_repo, progress=None):
    DEFAULT_BRANCHES = {"main", "master", STAGING_BRANCH, "develop", "development"}
    result           = []

    for repo in PRIMARY_REPOS:
        if progress:
            progress.step(f"Scanning branches: {repo}")

        branches = run_gh(
            ["api", f"repos/{ORG}/{repo}/branches?per_page=100"],
            default=[], silent=True, progress=progress,
        )
        if not isinstance(branches, list):
            continue
        time.sleep(CALL_DELAY)

        open_refs = open_head_refs_by_repo.get(repo, set())

        candidates = [
            b["name"] for b in branches
            if b.get("name") not in DEFAULT_BRANCHES
            and b.get("name") not in open_refs
            and not b.get("protected", False)
        ]

        n_to_check = min(len(candidates), MY_BRANCHES_PER_REPO * 3)
        if progress:
            progress.add(n_to_check)

        repo_results = []
        for branch_name in candidates[:n_to_check]:
            if len(repo_results) >= MY_BRANCHES_PER_REPO:
                break

            if progress:
                progress.step(f"Branch: {repo}/{branch_name[:30]}")

            commits = run_gh(
                ["api", f"repos/{ORG}/{repo}/commits?sha={branch_name}&per_page=1"],
                default=[], silent=True, progress=progress,
            )
            time.sleep(CALL_DELAY)

            if not isinstance(commits, list) or not commits:
                continue

            author_login = (commits[0].get("author") or {}).get("login", "")
            if author_login != MY_USERNAME:
                continue

            commit_info = commits[0].get("commit", {})
            raw_date    = (
                (commit_info.get("committer") or {}).get("date")
                or (commit_info.get("author") or {}).get("date", "")
            )
            if not raw_date:
                continue

            try:
                commit_dt = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
            except Exception:
                continue

            days_old = (datetime.now(timezone.utc) - commit_dt).days

            compare  = run_gh(
                ["api", f"repos/{ORG}/{repo}/compare/main...{branch_name}"],
                default={}, silent=True, progress=progress,
            )
            time.sleep(CALL_DELAY)

            ahead_by  = compare.get("ahead_by",  0) if isinstance(compare, dict) else 0
            behind_by = compare.get("behind_by", 0) if isinstance(compare, dict) else 0

            repo_results.append({
                "repo":         repo,
                "branch":       branch_name,
                "lastCommitAt": raw_date,
                "daysOld":      days_old,
                "aheadBy":      ahead_by,
                "behindBy":     behind_by,
            })

        result.extend(repo_results)

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
