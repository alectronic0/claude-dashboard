# Claude Work Dashboard

A local HTML dashboard that gives you a live view of your work — Jira tickets in a Kanban board, GitHub PRs (yours, your team's, repo-wide), app health, on-call rotation, calendar, and Claude plans, skills, agents and MCP servers — all in one place.

Designed to be used alongside [Claude Code](https://claude.ai/code). Every card has a **✦ Ask Claude** button that copies a context-rich prompt straight to your clipboard.

---

## Tabs

| Tab | What it shows |
|-----|---------------|
| **Tasks** | Jira tickets in a Kanban (Critical / Urgent / In Review / In Progress / Backlog), deadline banners, CI nudges, linked PRs per ticket, Claude plan cards, static personal cards |
| **PRs** | My PRs, team PRs, repo-wide PRs, assigned-to-me — grouped by repo with CI / approval / staging chips and next-action badges |
| **Team** | Team member cards with open PRs, on-call status, links to GitHub, Slack, Jira, PagerDuty |
| **App** | App deployment status and health per environment (prod/staging), service counts, deploy metadata |
| **Skills & Agents** | Searchable catalogue of your Claude Code skills and agents |
| **Claude** | MCP servers and hooks at a glance |
| **Design System** | Visual reference for all reusable UI components — colours, chips, badges, cards, kanban headers |

---

## Features

- **Nudge bar** — top-of-page alerts for failing CI, approaching deadlines, stale drafts, PRs awaiting review
- **Calendar bar** — today and tomorrow's meetings with Meet links
- **On-call bar** — current on-call per schedule with upcoming rotation
- **Persistent collapse state** — sections remember open/closed between reloads
- **One-click prompts** — every card copies a ready-to-paste Claude prompt
- **Partial refresh** — update only GitHub, Jira, or local data independently

---

## Requirements

- Python 3.9+
- [`gh` CLI](https://cli.github.com/) — authenticated (`gh auth login`)
- (Optional) Jira Cloud account + API token
- (Optional) PagerDuty API token (for on-call)
- (Optional) Google Calendar credentials (for calendar events)

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/alectronic0/claude-dashboard ~/.claude/app/dashboard
cd ~/.claude/app/dashboard
```

Or clone anywhere — the script uses its own directory as the working directory.

### 2. Create your config

```bash
cp config.example.json config.json
```

Edit `config.json` with your values. Minimum required config:

```json
{
  "github": {
    "username": "your-github-username",
    "org": "your-github-org",
    "primary_repos": ["repo1", "repo2"]
  },
  "dashboard": {
    "title": "My Work Dashboard",
    "subtitle": "My Team · My Company"
  }
}
```

See `config.example.json` for the full structure including Jira, Slack, PagerDuty, app health monitoring, config repos, and team member details.

| Field | Required | Description |
|-------|----------|-------------|
| `github.username` | Yes | Your GitHub login |
| `github.org` | Yes | GitHub org to search PRs in |
| `github.primary_repos` | Yes | Repos to watch for PRs, branch protection, stale branches |
| `github.team_members` | No | Team member logins — their PRs appear in the Team tab |
| `github.staging_branch` | No | Staging branch name (default: `staging`) |
| `jira.project` | No | Jira project key (e.g. `PROJ`) |
| `jira.base_url` | No | Jira base URL (e.g. `https://yourcompany.atlassian.net`) |
| `slack.base_url` | No | Slack base URL for team member links |
| `pagerduty.schedule_ids` | No | PagerDuty schedule IDs to show on-call for |
| `pagerduty.my_email` | No | Your PagerDuty email — highlights when you're on call |
| `pagerduty.base_url` | No | PagerDuty base URL for links |
| `dashboard.title` | No | Header title |
| `dashboard.subtitle` | No | Header subtitle |
| `apps` | No | App health monitoring — see [App health](#app-health-monitoring) |
| `team` | No | Team member details — see [Team tab](#team-tab) |

### 3. Set credentials

**Jira** (optional):
```bash
export JIRA_URL="https://yourcompany.atlassian.net"
export JIRA_USERNAME="your@email.com"
export JIRA_API_TOKEN="your-api-token"
```
Get a token at: https://id.atlassian.com/manage-profile/security/api-tokens

**PagerDuty** (optional):
```bash
export PAGERDUTY_API_TOKEN="your-token"
```

Add these to your `~/.zshrc` / `~/.bashrc` to persist them.

### 4. Run the refresh script

```bash
python3 refresh.py
```

Selective refresh (faster):

```bash
python3 refresh.py --github    # GitHub PRs only
python3 refresh.py --jira      # Jira tickets only
python3 refresh.py --local     # Plans + Claude filesystem + calendar + on-call + app health
python3 refresh.py --oncall    # PagerDuty on-call only
python3 refresh.py --calendar  # Google Calendar only
```

### 5. Open the dashboard

```bash
open work-dashboard.html
```

Reload the page after each refresh to see updated data.

---

## App health monitoring

The App tab shows deployment status and health for your services. Configure health check endpoints in `config.json`:

```json
{
  "apps": [
    {
      "name": "my-api",
      "environments": {
        "production": {
          "health_url":    "https://my-api.example.com/health",
          "dashboard_url": "https://deploy-tool.example.com/apps/my-api"
        },
        "staging": {
          "health_url":    "https://staging.my-api.example.com/health",
          "dashboard_url": "https://deploy-tool-staging.example.com/apps/my-api"
        }
      }
    }
  ]
}
```

The fetcher calls each `health_url` — HTTP 200 = healthy, non-200 = degraded, error = failed. The `dashboard_url` is linked from the environment header in the App tab.

If your repos don't have health endpoints, omit the `apps` section and the App tab will show repos from `primary_repos` with a placeholder.

---

## Team tab

Add team members to `config.json` to show their open PRs, on-call status, and profile links:

```json
{
  "team": [
    {
      "name": "Ada Lovelace",
      "github": "ada",
      "role": "Senior Engineer",
      "email": "ada@example.com",
      "slack": "ada-slack-handle",
      "jiraId": "atlassian-account-id",
      "pdId":   "pagerduty-user-id"
    }
  ]
}
```

All fields except `name`, `github`, and `role` are optional.

---

## Claude Code integration

### Nudge hook — critical alerts on every prompt

`nudge-hook.py` reads `dashboard-data.js` and injects **red nudges** (failing CI, imminent deadlines) directly into Claude's context on every prompt. You never need to open the browser to know something is on fire.

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "command": "python3 ~/.claude/app/dashboard/nudge-hook.py 2>/dev/null",
            "type": "command"
          }
        ]
      }
    ]
  }
}
```

When there are red nudges, Claude will see:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠  DASHBOARD NUDGES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 CI failing: my-repo #123
🔴 Deadline 3d: PROJ-456 — My ticket summary
```

Silent when nothing is on fire. Ignores data older than 24h.

### Refresh skill — `/refresh-dashboard`

Create `~/.claude/skills/refresh-dashboard/SKILL.md`:

```markdown
---
name: refresh-dashboard
description: |
  Refresh the local work dashboard data and report what changed.
  Runs python3 ~/.claude/app/dashboard/refresh.py then summarises the result.
  Use when: dashboard data is stale, after merging PRs, before standup.
user-invocable: true
version: 1.0.0
---

## What to do

1. Determine the flag: --github, --jira, --local, or none (full refresh)
2. Run: python3 ~/.claude/app/dashboard/refresh.py [flag]
3. Report: PR count, ticket count, any red nudges, data timestamp
4. If user asks to open: open ~/.claude/app/dashboard/work-dashboard.html
```

Then type `/refresh-dashboard` in any Claude Code session to refresh and get a summary.

---

## Customising the static cards

The Tasks tab has static swimlanes for recurring items that don't live in Jira (token rotations, side projects, ideas, etc.).

Edit `work-dashboard.html` directly to add your own cards:

```html
<div class="card">
  <div class="card-header">
    <div class="card-meta">
      <span class="no-ticket-label">Label</span>
      <span class="badge badge-progress">Status</span>
    </div>
    <div class="card-title">Card title</div>
  </div>
  <div class="next-action"><strong>Next:</strong> What to do next.</div>
  <button class="claude-prompt-btn"
    data-prompt="Your prompt text"
    onclick="copyPrompt(this)">✦ Ask Claude</button>
</div>
```

Card modifiers: `card alert` (yellow), `card critical` (red), `card no-ticket` (dashed border), `card urgent` (green), `card plan` (purple).

See the **Design System tab** in the dashboard for a visual reference of all available components, colours, and badge classes.

---

## Claude Plans integration

If you use `~/.claude/plans/` to store Claude Code plan files, they appear as cards in the Tasks tab after a `--local` refresh.

Add metadata to `~/.claude/memory/active-work.md` under a `## Plans` section:

```markdown
## Plans

| Plan | What | Kickoff prompt |
|------|------|----------------|
| [my-plan](~/.claude/plans/my-plan.md) | What this plan is about | Let's kick off my-plan |
```

---

## Active-work.md integration

The refresh script reads `~/.claude/memory/active-work.md` for two optional things:

- **Next actions** — a `## Dashboard — Work` table with per-ticket next steps shown below each Jira card
- **Internal priority overrides** — an `## Internal Priority Overrides` table to bump ticket priority beyond what Jira shows

The dashboard works fine without either.

---

## Data files

| File | Description |
|------|-------------|
| `dashboard-data.js` | Merged data — written by refresh script, loaded by the HTML |
| `cache-github.js` | GitHub PR cache |
| `cache-jira.js` | Jira ticket cache |
| `cache-local.js` | Local data cache (Claude, calendar, on-call, app health) |

All generated files are gitignored. Caches are merged on every refresh — partial refreshes only update their own cache then re-merge.

---

## GitHub rate limits

The script is designed to stay well within GitHub API limits:

| API | Limit | Usage |
|-----|-------|-------|
| REST core | 5,000/hr | Branch protection, compare, repo metadata |
| Search | 30/min | 3 calls per full run |
| GraphQL | 5,000/hr | PR enrichment (CI, reviews, branch info) |

A 0.5s delay between calls avoids secondary rate limit detection.

---

## Troubleshooting

**`config.json not found`** — copy `config.example.json` to `config.json` and fill it in.

**`gh: command not found`** — install the [GitHub CLI](https://cli.github.com/) and run `gh auth login`.

**Jira tickets not loading** — check `JIRA_URL`, `JIRA_USERNAME`, `JIRA_API_TOKEN` are set in your environment. Run `python3 refresh.py --jira` to see the error.

**Dashboard shows old data** — run `python3 refresh.py` then reload the page. The HTML loads data from `dashboard-data.js` at page load time.

**SSL errors (corporate proxy)** — set `JIRA_SSL_VERIFY=false` to disable certificate verification for Jira requests.

**App health all showing "No data"** — add an `apps` section to `config.json` with `health_url` per environment, then run `python3 refresh.py --local`.
