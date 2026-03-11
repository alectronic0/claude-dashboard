# Claude Work Dashboard

A local HTML dashboard that gives you a live view of your work — Jira tickets in a Kanban board, GitHub PRs (yours, your team's, repo-wide), Claude plans, skills, agents, and MCP servers — all in one place.

Designed to be used alongside [Claude Code](https://claude.ai/code). Every card has a **✦ Ask Claude** button that copies a context-rich prompt straight to your clipboard.

![dashboard preview](https://github.com/user-attachments/assets/placeholder)

---

## Features

- **Work tab** — Jira tickets in a Kanban (Critical/Urgent/In Review/In Progress/Backlog), deadline banners, CI nudges, linked PRs per ticket, Claude plan cards
- **PRs tab** — My PRs, team PRs, repo-wide PRs, assigned-to-me, stale PRs — grouped by repo with CI/approval/staging chips
- **Skills & Agents tab** — searchable catalogue of your Claude Code skills and agents
- **Claude tab** — MCP servers and hooks at a glance
- **Nudge bar** — top-of-page alerts for failing CI, approaching deadlines, stale drafts, PRs with no reviews
- **Persistent collapse state** — sections remember open/closed between reloads
- **One-click prompts** — every card copies a ready-to-paste Claude prompt

---

## Requirements

- Python 3.9+
- [`gh` CLI](https://cli.github.com/) — authenticated (`gh auth login`)
- (Optional) Jira Cloud account + API token

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
cd ~/.claude/app/dashboard
cp config.example.json config.json
```

Edit `config.json`:

```json
{
  "github": {
    "username": "your-github-username",
    "org": "your-github-org",
    "team_members": ["teammate1", "teammate2"],
    "primary_repos": ["repo1", "repo2"],
    "staging_branch": "staging"
  },
  "jira": {
    "project": "PROJ"
  },
  "dashboard": {
    "title": "My Work Dashboard",
    "subtitle": "My Team · My Company"
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `github.username` | Yes | Your GitHub login |
| `github.org` | Yes | GitHub org to search PRs in |
| `github.team_members` | No | Team member logins — their PRs appear in the Team section |
| `github.primary_repos` | Yes | Repos to watch for PRs, branch protection, stale branches |
| `github.staging_branch` | No | Staging branch name (default: `staging`) |
| `jira.project` | No | Jira project key (e.g. `PROJ`) — omit to skip Jira |
| `dashboard.title` | No | Header title |
| `dashboard.subtitle` | No | Header subtitle |

### 3. Set Jira credentials (if using Jira)

```bash
export JIRA_URL="https://yourcompany.atlassian.net"
export JIRA_USERNAME="your@email.com"
export JIRA_API_TOKEN="your-api-token"
```

Add these to your `~/.zshrc` / `~/.bashrc` to persist them.

Get an API token at: https://id.atlassian.com/manage-profile/security/api-tokens

### 4. Run the refresh script

```bash
python3 refresh.py
```

Selective refresh (faster):

```bash
python3 refresh.py --github   # GitHub PRs only
python3 refresh.py --jira     # Jira tickets only
python3 refresh.py --local    # Plans + Claude filesystem only
```

### 5. Open the dashboard

```bash
open work-dashboard.html
```

Reload the page after each refresh to see updated data.

---

## Claude Code integration

The dashboard ships with two integrations that make it part of your Claude Code workflow.

### Nudge hook — critical alerts on every prompt

`nudge-hook.py` reads `dashboard-data.js` and injects **red nudges** (failing CI, imminent deadlines) directly into Claude's context on every prompt. You never need to open the browser to know something is on fire.

**Setup — add to `~/.claude/settings.json`:**

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

The Work tab has two static swimlanes — **General** and **Personal** — for recurring items that don't live in Jira (token rotations, side projects, ideas, etc.).

Edit `work-dashboard.html` directly to add your own cards. Each card follows this pattern:

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
    data-prompt="Prompt text copied to clipboard"
    onclick="copyPrompt(this)">✦ Prompt text copied to clipboard</button>
</div>
```

Card modifiers: `card alert` (yellow), `card critical` (red), `card no-ticket` (dashed border).

Badge classes: `badge-critical`, `badge-alert`, `badge-review`, `badge-progress`, `badge-blocked`.

---

## Claude Plans integration

If you use `~/.claude/plans/` to store Claude Code plan files, they automatically appear as cards in the Work tab after a `--local` refresh.

Add metadata to `~/.claude/memory/active-work.md` under a `## Plans` section:

```markdown
## Plans

| Plan | What | Kickoff prompt |
|------|------|----------------|
| [my-plan](~/.claude/plans/my-plan.md) | What this plan is about | Let's kick off my-plan |
```

---

## Active-work.md integration

The refresh script reads `~/.claude/memory/active-work.md` for two things:

- **Next actions** — a `## Dashboard — Work` table with per-ticket next steps
- **Internal priority overrides** — an `## Internal Priority Overrides` table to bump ticket priority beyond what Jira shows

These are optional — the dashboard works without them.

---

## Data files

| File | Description |
|------|-------------|
| `dashboard-data.js` | Merged data (written by refresh script, loaded by HTML) |
| `cache-github.js` | GitHub PR cache |
| `cache-jira.js` | Jira ticket cache |
| `cache-local.js` | Local Claude data cache |

All generated files are gitignored. Caches are merged on every full refresh — partial refreshes (`--github`, `--jira`, `--local`) only update their own cache then re-merge.

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
