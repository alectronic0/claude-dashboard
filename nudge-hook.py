#!/usr/bin/env python3
"""
Dashboard nudge hook for Claude Code.

Reads dashboard-data.js and injects critical nudges (failing CI, imminent
deadlines) into Claude's context via UserPromptSubmit hook output.

Only fires when there are red nudges and data is fresh (< 24h old).
"""
import json
import os
import re
import datetime

DIR       = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(DIR, "dashboard-data.js")
MAX_AGE_H = 24


def _load_data():
    if not os.path.isfile(DATA_FILE):
        return None
    with open(DATA_FILE) as f:
        content = f.read()
    m = re.search(r'window\.DASHBOARD_DATA\s*=\s*({.*})\s*;?\s*$', content, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception:
        return None


def _is_fresh(data):
    generated_at = data.get("generatedAt", "")
    if not generated_at:
        return False
    try:
        gen_dt   = datetime.datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
        age_h    = (datetime.datetime.now(datetime.timezone.utc) - gen_dt).total_seconds() / 3600
        return age_h <= MAX_AGE_H
    except Exception:
        return False


def main():
    data = _load_data()
    if not data or not _is_fresh(data):
        return

    nudges   = []
    my_prs   = data.get("myPRs", [])
    tickets  = data.get("jiraTickets", [])
    today    = datetime.date.today()

    for pr in my_prs:
        if pr.get("ciStatus") == "failing" and not pr.get("isDraft") and not pr.get("isMerged"):
            repo = pr.get("repoName") or (pr.get("repository") or {}).get("name", "")
            nudges.append(f"CI failing: {repo} #{pr['number']}")

    for t in tickets:
        if not t.get("dueDate"):
            continue
        try:
            due       = datetime.date.fromisoformat(t["dueDate"])
            days_left = (due - today).days
            if 0 <= days_left <= 7:
                summary = t.get("summary", "")[:50]
                nudges.append(f"Deadline {days_left}d: {t['key']} — {summary}")
        except Exception:
            pass

    if not nudges:
        return

    print("━" * 48)
    print("⚠  DASHBOARD NUDGES")
    print("━" * 48)
    for n in nudges:
        print(f"🔴 {n}")


main()
