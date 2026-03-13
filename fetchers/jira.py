import base64
import json
import os
import ssl
import sys
import urllib.request
import urllib.parse

from .utils import JIRA_PROJECT


def fetch_jira_tickets(progress=None):
    """Fetch assigned tickets from Jira REST API using config + env var credentials."""
    jira_url   = os.environ.get("JIRA_URL", "").rstrip("/")
    username   = os.environ.get("JIRA_USERNAME", "")
    token      = os.environ.get("JIRA_API_TOKEN", "")
    ssl_verify = os.environ.get("JIRA_SSL_VERIFY", "true").lower() not in ("false", "0", "no")

    if not all([jira_url, username, token]):
        print("  Warning: JIRA_URL / JIRA_USERNAME / JIRA_API_TOKEN not set — skipping Jira", file=sys.stderr)
        return []

    label = "Fetching Jira tickets (all projects, assigned to me, not Done)..."
    if progress:
        progress.step(label)
    else:
        print(f"  {label}", file=sys.stderr)

    url  = f"{jira_url}/rest/api/3/search/jql"
    body = json.dumps({
        "jql":        "assignee = currentUser() AND statusCategory != Done ORDER BY priority ASC, updated DESC",
        "maxResults": 100,
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
