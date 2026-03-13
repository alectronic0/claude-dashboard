import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

from .utils import PD_SCHEDULE_IDS, PD_MY_EMAIL

# How many upcoming rotations to fetch (current + this many ahead).
_UPCOMING_COUNT = 30


def fetch_oncall_data(progress=None):
    """Fetch current + upcoming on-call rotation from PagerDuty."""
    token = os.environ.get("PAGERDUTY_API_KEY", "")
    if not token or not PD_SCHEDULE_IDS:
        return []

    label = "Fetching PagerDuty on-call..."
    if progress:
        progress.step(label)
    else:
        print(f"  {label}", file=sys.stderr)

    now   = datetime.now(timezone.utc)
    until = now + timedelta(weeks=12)
    since_str = urllib.parse.quote(now.isoformat())
    until_str = urllib.parse.quote(until.isoformat())

    params = "&".join(f"schedule_ids[]={sid}" for sid in PD_SCHEDULE_IDS)
    url = (
        f"https://api.pagerduty.com/oncalls"
        f"?{params}"
        f"&since={since_str}"
        f"&until={until_str}"
        f"&include[]=users"
    )
    req = urllib.request.Request(url, headers={
        "Authorization": f"Token token={token}",
        "Accept":        "application/vnd.pagerduty+json;version=2",
    })

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        print(f"  Warning: PagerDuty fetch failed — {e}", file=sys.stderr)
        return []

    # Keep only primary (escalation_level=1) entries, sorted by start time.
    primary = sorted(
        [oc for oc in data.get("oncalls", []) if oc.get("escalation_level") == 1],
        key=lambda oc: oc.get("start", ""),
    )

    # Per schedule: keep up to _UPCOMING_COUNT entries.
    seen_schedules: dict[str, list] = {}
    for oc in primary:
        sid = (oc.get("schedule") or {}).get("id", "")
        if sid not in seen_schedules:
            seen_schedules[sid] = []
        if len(seen_schedules[sid]) < _UPCOMING_COUNT:
            seen_schedules[sid].append(oc)

    result = []
    for sid, entries in seen_schedules.items():
        for i, oc in enumerate(entries):
            schedule = oc.get("schedule") or {}
            user     = oc.get("user") or {}
            email    = user.get("email", "")
            result.append({
                "scheduleId":   schedule.get("id", ""),
                "scheduleName": schedule.get("summary", ""),
                "userId":       user.get("id", ""),
                "userName":     user.get("name", ""),
                "userEmail":    email,
                "isMe":         bool(PD_MY_EMAIL and email.lower() == PD_MY_EMAIL.lower()),
                "isCurrent":    i == 0,
                "start":        oc.get("start", ""),
                "end":          oc.get("end", ""),
            })

    return result
