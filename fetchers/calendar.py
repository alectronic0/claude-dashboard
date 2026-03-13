import json
import os
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta

from .utils import GCAL_CREDS_DIR


def _find_creds_file():
    if not os.path.isdir(GCAL_CREDS_DIR):
        return None
    for name in os.listdir(GCAL_CREDS_DIR):
        if name.endswith(".json"):
            return os.path.join(GCAL_CREDS_DIR, name)
    return None


def _load_google_token():
    creds_path = _find_creds_file()
    if creds_path is None:
        return None

    with open(creds_path) as f:
        creds = json.load(f)

    token  = creds.get("token")
    expiry = creds.get("expiry", "")

    if token and expiry:
        try:
            exp_dt = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
            if exp_dt > datetime.now(timezone.utc) + timedelta(minutes=2):
                return token
        except Exception:
            pass

    refresh_token = creds.get("refresh_token", "")
    token_uri     = creds.get("token_uri", "")
    client_id     = creds.get("client_id", "")
    client_secret = creds.get("client_secret", "")

    if not all([refresh_token, token_uri, client_id, client_secret]):
        print("  Warning: Google credentials incomplete — cannot refresh token", file=sys.stderr)
        return None

    body = urllib.parse.urlencode({
        "grant_type":    "refresh_token",
        "client_id":     client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
    }).encode()

    req = urllib.request.Request(token_uri, data=body, headers={
        "Content-Type": "application/x-www-form-urlencoded",
    }, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
    except Exception as e:
        print(f"  Warning: Google token refresh failed — {e}", file=sys.stderr)
        return None

    new_token  = result.get("access_token")
    expires_in = result.get("expires_in", 3600)

    if not new_token:
        print("  Warning: Google token refresh returned no access_token", file=sys.stderr)
        return None

    new_expiry = (datetime.now(timezone.utc) + timedelta(seconds=expires_in - 60)).isoformat()
    creds["token"]  = new_token
    creds["expiry"] = new_expiry

    try:
        with open(creds_path, "w") as f:
            json.dump(creds, f, indent=2)
    except Exception as e:
        print(f"  Warning: could not write updated Google credentials — {e}", file=sys.stderr)

    return new_token


def fetch_calendar_events(progress=None):
    """Fetch this month's calendar events from Google Calendar primary calendar."""
    if progress:
        progress.step("Fetching Google Calendar events...")
    else:
        print("  Fetching Google Calendar events...", file=sys.stderr)

    token = _load_google_token()
    if token is None:
        return []

    now      = datetime.now(timezone.utc)
    time_min = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    time_max = (now + timedelta(days=30)).replace(hour=23, minute=59, second=59, microsecond=0).isoformat()

    params = urllib.parse.urlencode({
        "timeMin":      time_min,
        "timeMax":      time_max,
        "maxResults":   100,
        "singleEvents": "true",
        "orderBy":      "startTime",
    })

    url = f"https://www.googleapis.com/calendar/v3/calendars/primary/events?{params}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
    })

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        print(f"  Warning: Google Calendar fetch failed — {e}", file=sys.stderr)
        return []

    events = []
    for item in data.get("items", []):
        start = (item.get("start") or {}).get("dateTime")
        if not start:
            continue

        attendees = item.get("attendees") or []
        declined  = any(
            a.get("self") and a.get("responseStatus") == "declined"
            for a in attendees
        )
        if declined:
            continue

        meet_link = None
        conf_data = item.get("conferenceData") or {}
        for ep in conf_data.get("entryPoints") or []:
            if ep.get("entryPointType") == "video":
                meet_link = ep.get("uri")
                break

        location   = item.get("location") or ""
        is_online  = bool(meet_link) or "meet.google.com" in location

        response_status = "accepted"
        for a in attendees:
            if a.get("self"):
                response_status = a.get("responseStatus", "accepted")
                break

        events.append({
            "id":             item.get("id", ""),
            "title":          item.get("summary", "(no title)"),
            "date":           start[:10],
            "start":          start,
            "end":            (item.get("end") or {}).get("dateTime", ""),
            "url":            item.get("htmlLink", ""),
            "isOnline":       is_online,
            "meetLink":       meet_link or "",
            "responseStatus": response_status,
        })

    return events
