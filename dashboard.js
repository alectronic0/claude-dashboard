// ── Local (non-Jira) tasks — add your own tasks here ─────────────────────────
const LOCAL_TASKS = [
  // Example: { id: 'my-task', title: 'My task', label: '⚠ No Ticket', cardClass: 'no-ticket', nextAction: 'Do the thing.', prompt: "Let's look into my task." },
];

// ── Team members — loaded from config via DASHBOARD_DATA.teamMembers ──────────
const TEAM_MEMBERS = (window.DASHBOARD_DATA || {}).teamMembers || [];


// ── Tab switching ──────────────────────────────────────────────────────────────
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

function switchTab(id) {
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  tabPanels.forEach(p => p.classList.toggle('active', p.id === 'tab-' + id));
  try { localStorage.setItem('dashboard-tab', id); } catch(e) {}
}

tabBtns.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
const savedTab = (() => { try { return localStorage.getItem('dashboard-tab'); } catch(e) { return null; } })();
if (savedTab) switchTab(savedTab);

// ── Utilities ──────────────────────────────────────────────────────────────────
function copyText(el, text) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = el.textContent;
    el.classList.add('copied');
    el.textContent = '✓ Copied';
    setTimeout(() => { el.classList.remove('copied'); el.textContent = orig; }, 1500);
  });
}

function copyPrompt(btn) {
  const text = btn.dataset.prompt;
  const originalHTML = btn.innerHTML;
  navigator.clipboard.writeText(text).then(() => {
    btn.classList.add('copied');
    btn.innerHTML = '✓ Copied!';
    setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = originalHTML; }, 1500);
  });
}

function promptBtn(promptText) {
  return `<button class="claude-prompt-btn" data-prompt="${escHtml(promptText)}" onclick="copyPrompt(this)">`
    + `<div class="prompt-btn-title">✦ Ask Claude...</div>`
    + `<div class="prompt-btn-text">${escHtml(promptText)}</div>`
    + `</button>`;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatAge(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 7) return d + 'd ago';
  const w = Math.floor(d / 7);
  if (w < 5) return w + 'w ago';
  const mo = Math.floor(d / 30);
  if (mo < 12) return mo + 'mo ago';
  return Math.floor(d / 365) + 'y ago';
}

function baseBranchChip(base) {
  if (!base) return '';
  const cls = (base === 'main' || base === 'master') ? 'chip-green' : base === 'staging' ? 'chip-purple' : 'chip-grey';
  return `<span class="chip ${cls}">→ ${escHtml(base)}</span>`;
}

function jiraKeyFromText(text) {
  const m = (text || '').match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
  return m ? m[1] : null;
}

function jiraUrlForKey(key, tickets) {
  const t = (tickets || []).find(t => t.key === key);
  if (t && t.url) return t.url;
  const sample = tickets && tickets.length && tickets[0];
  if (sample && sample.url) return sample.url.replace(/\/browse\/[^/]+$/, '/browse/') + key;
  const jiraBase = (window.DASHBOARD_DATA || {}).jiraBaseUrl || '';
  return jiraBase ? `${jiraBase}/browse/${key}` : '#';
}

function prDescSnippet(body) {
  if (!body) return '';
  const text = body
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('|') && l !== '---')[0] || '';
  return text.length > 150 ? text.slice(0, 150) + '…' : text;
}

const REFRESH_CMD = 'python3 ~/.claude/app/dashboard/refresh.py';

function noDataPlaceholder(icon, title) {
  return '<div style="padding:32px;text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:10px;">'
    + `<div style="font-size:32px;margin-bottom:12px;">${icon}</div>`
    + `<div style="font-size:15px;color:var(--text);margin-bottom:8px;">${title}</div>`
    + `<div style="font-size:13px;color:var(--text-muted);">Run: <code>${REFRESH_CMD}</code> then reload</div>`
    + '</div>';
}

function dataTimestamp(generatedAt) {
  return `<div style="font-size:11px;color:var(--text-dim);margin-bottom:20px;">Data as of ${new Date(generatedAt).toLocaleString()}</div>`;
}

// ── Header stats ───────────────────────────────────────────────────────────────
function updateHeaderStats(data) {
  const updatedEl = document.getElementById('stat-updated');
  const reviewEl = document.getElementById('stat-in-review');
  const ticketsEl = document.getElementById('stat-tickets');

  if (updatedEl && data.generatedAt) updatedEl.textContent = formatAge(data.generatedAt);
  if (reviewEl) {
    const inReview = (data.jiraTickets || []).filter(t => /review/i.test(t.status)).length;
    reviewEl.textContent = inReview;
  }
  if (ticketsEl) ticketsEl.textContent = (data.jiraTickets || []).length;
}

function renderRefreshTimestamps(data) {
  const r = data && data.refreshedAt;
  if (!r) return;
  const labels = { github: 'GitHub', jira: 'Jira', local: 'Local', oncall: 'On-call', calendar: 'Calendar' };
  document.querySelectorAll('.refresh-btn[data-source]').forEach(btn => {
    const src = btn.dataset.source;
    if (src === 'all') {
      const oldest = Object.values(r).filter(Boolean).sort()[0];
      if (oldest) btn.innerHTML = `↺ All <span class="refresh-btn-age">${formatAge(oldest)}</span>`;
    } else if (r[src]) {
      const label = labels[src] || src;
      btn.innerHTML = `${label} <span class="refresh-btn-age">${formatAge(r[src])}</span>`;
    }
  });
}

// ── Work tab ───────────────────────────────────────────────────────────────────
function hasDeadlineSoon(ticket) {
  if (!ticket.dueDate) return false;
  const daysLeft = (new Date(ticket.dueDate).getTime() - Date.now()) / 86400000;
  return daysLeft >= 0 && daysLeft <= 14;
}

function formatDeadline(dueDate) {
  const d = new Date(dueDate);
  const daysLeft = Math.ceil((d.getTime() - Date.now()) / 86400000);
  const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  if (daysLeft === 0) return `Deadline: TODAY (${dateStr})`;
  if (daysLeft === 1) return `Deadline: tomorrow (${dateStr})`;
  return `Deadline: ${dateStr} (${daysLeft}d)`;
}

function priorityCardClass(p) {
  if (!p) return '';
  const pl = p.toLowerCase();
  if (pl === 'critical' || pl === 'highest') return 'critical';
  if (pl === 'high') return 'urgent';
  return '';
}

function deadlineUpgradeClass(ticket, existingClass) {
  if (!ticket.dueDate || existingClass === 'critical') return '';
  const daysLeft = (new Date(ticket.dueDate).getTime() - Date.now()) / 86400000;
  if (daysLeft < 0) return '';
  if (daysLeft < 7) return 'critical';
  if (daysLeft <= 14) return existingClass === 'urgent' ? '' : 'urgent';
  return 'deadline';
}

function priorityBadge(p) {
  if (!p) return '';
  const pl = p.toLowerCase();
  if (pl === 'critical' || pl === 'highest') return '<span class="badge badge-critical">Critical</span>';
  if (pl === 'high') return '<span class="badge badge-alert">High</span>';
  return '';
}

function statusBadgeClass(status) {
  const sl = (status || '').toLowerCase();
  if (sl.includes('review')) return 'badge-review';
  if (sl.includes('block')) return 'badge-blocked';
  if (sl.includes('progress')) return 'badge-progress';
  return 'badge-progress';
}

function prMatchesTicket(pr, ticketKey) {
  if ((pr.title || '').toUpperCase().includes(ticketKey)) return true;
  // Match branch name — covers branches like cpri-4519/remove-* where the title
  // doesn't include the ticket key.
  if ((pr.headRefName || '').toUpperCase().includes(ticketKey)) return true;
  // Only match body when the ticket key appears in a Jira browse URL — prevents
  // false positives from "Related PRs" sections mentioning other tickets.
  const jiraPattern = new RegExp('atlassian\\.net/browse/' + ticketKey, 'i');
  if (jiraPattern.test(pr.body || '')) return true;
  return false;
}

function cardPersistedOpen(key) {
  try { return localStorage.getItem(`card-${key}`) !== 'closed'; } catch(e) { return true; }
}

function workCard(ticket, myPRs, myMergedPRs, nextActions, internalPriorities) {
  const prs       = (myPRs || []).filter(pr => prMatchesTicket(pr, ticket.key));
  const mergedPRs = (myMergedPRs || []).filter(pr => prMatchesTicket(pr, ticket.key));
  const allPRs    = [...prs, ...mergedPRs].sort((a, b) => {
    const order = p => p.isMerged ? 2 : (p.isDraft ? 1 : 0);
    return order(a) - order(b);
  });

  const resolvedPriority = ((internalPriorities || {})[ticket.key]) || ticket.priority;
  const priorityClass    = priorityCardClass(resolvedPriority);
  const cardClass        = 'card ' + (priorityClass || deadlineUpgradeClass(ticket, priorityClass));
  const ticketSummary    = ticket.summary || '';
  const promptText       = `Let's look into ${ticket.key}, what can you tell me about this before we start?`;

  // PR count chips shown in collapsed summary
  const openCount   = prs.filter(p => !p.isDraft).length;
  const draftCount  = prs.filter(p => p.isDraft).length;
  const mergedCount = mergedPRs.length;
  const prChipParts = [
    openCount   ? `<span class="repo-count repo-count-open">${openCount} open</span>`       : '',
    draftCount  ? `<span class="repo-count repo-count-draft">${draftCount} draft</span>`    : '',
    mergedCount ? `<span class="repo-count repo-count-merged">${mergedCount} merged</span>` : '',
  ].filter(Boolean).join('');
  const prSummaryHtml = prChipParts ? `<div class="card-pr-summary">${prChipParts}</div>` : '';

  // Body content
  const prListHtml = allPRs.length
    ? '<div class="pr-list">' + allPRs.map(pr => {
        const { state, html: chipsHtml } = prChips(pr);
        const repo = pr.repoName || (pr.repository && pr.repository.name) || '';
        const titleLabel = `${repo ? repo + ' #' + pr.number : '#' + pr.number}${pr.title ? ' — ' + pr.title : ''}`;
        return `<a class="pr-row" href="${escHtml(pr.url)}" target="_blank">`
          + `<span class="pr-dot ${state}"></span>`
          + `<span class="pr-title">${escHtml(titleLabel)}</span>`
          + chipsHtml
          + `</a>`;
      }).join('') + '</div>'
    : '';
  const labels      = (ticket.labels || []).map(l => `<span class="chip chip-grey">${escHtml(l)}</span>`).join('');
  const labelsHtml  = labels ? `<div class="pr-chips" style="margin-bottom:10px;">${labels}</div>` : '';
  const deadlineBanner = hasDeadlineSoon(ticket)
    ? `<div class="deadline-banner">⏰ ${escHtml(formatDeadline(ticket.dueDate))}</div>`
    : '';
  const nextAction    = (nextActions || {})[ticket.key] || '';
  const nextActionHtml = nextAction
    ? `<div class="next-action"><strong>Next:</strong> ${escHtml(nextAction)}</div>`
    : '';
  const nudgesHtml = cardNudges(ticket, myPRs);

  const isOpen = cardPersistedOpen(ticket.key);
  return `<div class="${cardClass}">`
    + `<details class="card-collapsible" data-persist="card-${escHtml(ticket.key)}"${isOpen ? ' open' : ''}>`
    + `<summary class="card-summary">`
    + `<span class="card-toggle-arrow">▶</span>`
    + `<div class="card-summary-body">`
    + `<div class="card-summary-meta">`
    + `<a class="card-ticket-ref" href="${escHtml(ticket.url)}" target="_blank" onclick="event.stopPropagation()">${escHtml(ticket.key)}</a>`
    + `<span class="badge ${statusBadgeClass(ticket.status)}">${escHtml(ticket.status)}</span>`
    + priorityBadge(resolvedPriority)
    + `</div>`
    + `<a class="card-title card-title-link" href="${escHtml(ticket.url)}" target="_blank" onclick="event.stopPropagation()">${escHtml(ticketSummary)}</a>`
    + prSummaryHtml
    + `</div>`
    + `</summary>`
    + `<div class="card-body">`
    + deadlineBanner
    + labelsHtml
    + promptBtn(promptText)
    + nextActionHtml
    + prListHtml
    + nudgesHtml
    + `</div>`
    + `</details>`
    + `</div>`;
}

function localTaskCard(task) {
  const cardClass = 'card' + (task.cardClass ? ' ' + task.cardClass : '');
  const promptText = task.prompt || `Let's look into ${task.title}, what can you tell me about this before we start?`;
  const nextActionHtml = task.nextAction
    ? `<div class="next-action"><strong>Next:</strong> ${escHtml(task.nextAction)}</div>`
    : '';
  return `<div class="${cardClass}">`
    + `<div class="card-header">`
    + `<div class="card-meta"><span class="no-ticket-label">${escHtml(task.label || 'General')}</span></div>`
    + `<div class="card-title">${escHtml(task.title)}</div>`
    + `</div>`
    + promptBtn(promptText)
    + nextActionHtml
    + `</div>`;
}

function initPersistentDetails(container) {
  (container || document).querySelectorAll('details[data-persist]').forEach(d => {
    if (d.dataset.persistInit) return;
    d.dataset.persistInit = '1';
    d.addEventListener('toggle', () => {
      try { localStorage.setItem(d.dataset.persist, d.open ? 'open' : 'closed'); } catch(e) {}
    });
  });
}

function renderWorkTab() {
  const el = document.getElementById('work-content');
  if (!el) return;
  const data = window.DASHBOARD_DATA;
  el.innerHTML = renderPlansSwimLane(data) + renderKanbanSwimLane(data);
  initPersistentDetails(el);
}

function renderPlansSwimLane(data) {
  const plans = (data && data.plans) || [];
  const cards = plans.map(plan => {
    const kickoff = plan.kickoff || `Let's look into ${plan.name}, what can you tell me about this before we start?`;
    return `<div class="card plan">`
      + `<div class="card-header">`
      + `<div class="card-meta"><span class="no-ticket-label">Plan</span></div>`
      + `<div class="card-title">${escHtml(plan.name)}</div>`
      + `</div>`
      + (plan.what ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">${escHtml(plan.what)}</div>` : '')
      + promptBtn(kickoff)
      + `</div>`;
  }).join('');
  const body = plans.length
    ? `<div class="swimlane-cards">${cards}</div>`
    : `<p style="color:var(--text-dim);font-size:13px;padding:8px 0;">No plan files found — run refresh script.</p>`;
  const persistKey = 'work-plans';
  const isOpen = (() => { try { return localStorage.getItem(persistKey) !== 'closed'; } catch(e) { return true; } })();
  return `<details class="work-collapsible" data-persist="${persistKey}" ${isOpen ? 'open' : ''}>`
    + `<summary><span class="toggle-arrow">▶</span>📋 Claude Plans <span class="col-count">${plans.length}</span></summary>`
    + body
    + `</details>`;
}

function renderKanbanSwimLane(data) {
  const workPersistKey = 'work-kanban';
  const workIsOpen = (() => { try { return localStorage.getItem(workPersistKey) !== 'closed'; } catch(e) { return true; } })();
  if (!data || !data.jiraTickets || !data.jiraTickets.length) {
    return `<details class="work-collapsible" data-persist="${workPersistKey}" ${workIsOpen ? 'open' : ''}>`
      + `<summary><span class="toggle-arrow">▶</span>💼 Work</summary>`
      + noDataPlaceholder('📋', 'No Jira data loaded')
      + `</details>`;
  }
  const tickets = data.jiraTickets;
  const myPRs = data.myPRs || [];
  const myMergedPRs = data.myMergedPRs || [];
  const nextActions = data.nextActions || {};
  const internalPriorities = data.internalPriorities || {};
  const placed = new Set();

  function effectivePriority(t) {
    return (internalPriorities[t.key] || t.priority || '').toLowerCase();
  }

  function colOpen(type) {
    try { return localStorage.getItem(`kanban-col-${type}`) !== 'closed'; } catch(e) { return true; }
  }

  function col(label, type, filter) {
    const items = tickets.filter(t => !placed.has(t.key) && filter(t));
    items.forEach(t => placed.add(t.key));
    if (!items.length) return '';
    const open = colOpen(type);
    return `<details class="kanban-col" data-persist="kanban-col-${type}"${open ? ' open' : ''}>`
      + `<summary class="kanban-col-header col-${type}"><span class="kanban-col-arrow">▶</span>${label} <span class="col-count">${items.length}</span></summary>`
      + `<div class="kanban-col-body">`
      + items.map(t => workCard(t, myPRs, myMergedPRs, nextActions, internalPriorities)).join('')
      + `</div>`
      + `</details>`;
  }

  function priorityTier(t) {
    const ep = effectivePriority(t);
    if (ep === 'critical' || ep === 'highest') return 0;
    if (ep === 'high') return 1;
    if (t.dueDate) {
      const daysLeft = (new Date(t.dueDate).getTime() - Date.now()) / 86400000;
      if (daysLeft >= 0 && daysLeft < 7) return 0;
      if (daysLeft >= 7 && daysLeft <= 14) return 1;
    }
    return null;
  }

  function priorityCol() {
    const items = tickets.filter(t => !placed.has(t.key) && priorityTier(t) !== null);
    items.forEach(t => placed.add(t.key));
    if (!items.length) return '';
    const sorted = [...items].sort((a, b) => {
      const ta = priorityTier(a), tb = priorityTier(b);
      if (ta !== tb) return ta - tb;
      const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return da - db;
    });
    const open = colOpen('critical');
    return `<details class="kanban-col" data-persist="kanban-col-critical"${open ? ' open' : ''}>`
      + `<summary class="kanban-col-header col-critical"><span class="kanban-col-arrow">▶</span>🔴 Critical / Urgent / Deadline <span class="col-count">${sorted.length}</span></summary>`
      + `<div class="kanban-col-body">`
      + sorted.map(t => workCard(t, myPRs, myMergedPRs, nextActions, internalPriorities)).join('')
      + `</div>`
      + `</details>`;
  }

  function doneCol() {
    const sevenDaysAgo = Date.now() - 7 * 86400000;
    const items = tickets.filter(t => {
      if (placed.has(t.key)) return false;
      const isDone = t.statusCategory === 'Done' || /done|complete/i.test(t.status);
      if (!isDone) return false;
      const ts = t.resolutionDate || t.updatedAt;
      return !ts || new Date(ts).getTime() >= sevenDaysAgo;
    });
    items.forEach(t => placed.add(t.key));
    if (!items.length) return '';
    const open = colOpen('done');
    return `<details class="kanban-col" data-persist="kanban-col-done"${open ? ' open' : ''}>`
      + `<summary class="kanban-col-header col-done"><span class="kanban-col-arrow">▶</span>✅ Done (7d) <span class="col-count">${items.length}</span></summary>`
      + `<div class="kanban-col-body">`
      + items.map(t => workCard(t, myPRs, myMergedPRs, nextActions, internalPriorities)).join('')
      + `</div>`
      + `</details>`;
  }

  function generalCol() {
    if (!LOCAL_TASKS.length) return '';
    const open = colOpen('general');
    return `<details class="kanban-col" data-persist="kanban-col-general"${open ? ' open' : ''}>`
      + `<summary class="kanban-col-header col-general"><span class="kanban-col-arrow">▶</span>🧰 General <span class="col-count">${LOCAL_TASKS.length}</span></summary>`
      + `<div class="kanban-col-body">`
      + LOCAL_TASKS.map(t => localTaskCard(t)).join('')
      + `</div>`
      + `</details>`;
  }

  return `<details class="work-collapsible" data-persist="${workPersistKey}" ${workIsOpen ? 'open' : ''}>`
    + `<summary><span class="toggle-arrow">▶</span>💼 Work <span class="col-count">${tickets.length}</span></summary>`
    + dataTimestamp(data.generatedAt)
    + `<div class="kanban">`
    + priorityCol()
    + col('👀 In Review',          'review',   t => /review/i.test(t.status))
    + col('🚧 In Progress',        'progress', t => t.statusCategory === 'In Progress')
    + doneCol()
    + col('📋 Todo &amp; Backlog', 'backlog',  () => true)
    + generalCol()
    + `</div>`
    + `</details>`;
}

// ── PRs tab ────────────────────────────────────────────────────────────────────
function prStatusChips(pr) {
  const chips = [];
  if (pr.mergedToStaging != null) {
    chips.push(pr.mergedToStaging
      ? '<span class="chip chip-green">✓ Staged</span>'
      : '<span class="chip chip-red">✗ Not staged</span>');
  }
  if (pr.approvalCount != null) {
    const n = pr.approvalCount;
    const req = pr.requiredApprovals || 1;
    if (n >= req)   chips.push(`<span class="chip chip-green">✓ ${n} approved</span>`);
    else if (n > 0) chips.push(`<span class="chip chip-yellow">${n}/${req} approved</span>`);
    else            chips.push(`<span class="chip chip-grey">0/${req} approved</span>`);
  }
  return chips.join('');
}

function prFailLines(pr) {
  if (pr.isMerged) return '';
  const lines = [];
  if ((pr.checks || []).length) {
    (pr.checks || []).forEach(c => {
      if (c.name === 'check_staged_label') return; // already shown as staging chip
      if (c.state === 'failing')
        lines.push(`<div class="pr-fail-line"><span class="ci-badge ci-failing">Failing</span>${escHtml(c.name)}</div>`);
      else if (c.state === 'pending')
        lines.push(`<div class="pr-fail-line"><span class="ci-badge ci-pending">Pending</span>${escHtml(c.name)}</div>`);
    });
  } else {
    const s = pr.ciStatus;
    if (s === 'failing')
      lines.push('<div class="pr-fail-line"><span class="ci-badge ci-failing">Failing</span>CI</div>');
    else if (s === 'pending')
      lines.push('<div class="pr-fail-line"><span class="ci-badge ci-pending">Pending</span>CI</div>');
  }
  return lines.join('');
}

function prChips(pr) {
  const state = pr.isMerged ? 'merged' : (pr.isDraft ? 'draft' : 'open');
  const stateChip = pr.isMerged
    ? '<span class="chip chip-purple">Merged</span>'
    : (pr.isDraft ? '<span class="chip chip-grey">Draft</span>' : '<span class="chip chip-green">Open</span>');
  const age = formatAge(pr.updatedAt);
  const isStale = !pr.isDraft && !pr.isMerged && pr.updatedAt
    && (Date.now() - new Date(pr.updatedAt).getTime()) > 14 * 86400000;
  return { state,
    html: `<div class="pr-chips">`
      + baseBranchChip(pr.baseRefName)
      + stateChip
      + (pr.isMerged ? '' : prStatusChips(pr))
      + (age ? `<span class="chip chip-grey">${age}</span>` : '')
      + (isStale ? '<span class="chip chip-orange">Stale</span>' : '')
      + (!pr.isMerged && pr.behindBy > 0 ? `<span class="chip chip-yellow">${pr.behindBy} behind main</span>` : '')
      + `</div>`
      + prFailLines(pr)
  };
}

function prNextAction(pr, isMyPR) {
  if (pr.isMerged) return null;
  if (isMyPR) {
    if (pr.ciStatus === 'failing') return { cls: 'next-action-red', text: 'Fix CI' };
    if (pr.behindBy > 3) return { cls: 'next-action-yellow', text: `Rebase (${pr.behindBy} behind)` };
    const approved = (pr.approvalCount || 0) >= (pr.requiredApprovals || 1);
    if (pr.ciStatus === 'pending') return { cls: 'next-action-orange', text: 'CI pending' };
    if (approved && pr.mergedToStaging === false) return { cls: 'next-action-green', text: 'Merge to staging' };
    if (approved && pr.isDraft) return { cls: 'next-action-blue', text: 'Mark ready' };
    if (!approved && pr.isDraft) return { cls: 'next-action-grey', text: 'Draft — WIP' };
    if (!approved && !pr.isDraft) return { cls: 'next-action-yellow', text: 'Chase review' };
    return null;
  }
  const s = pr.myReviewStatus;
  if (s === 'review_requested') return { cls: 'next-action-yellow', text: 'Review needed' };
  if (s === 'approved') return { cls: 'next-action-green', text: 'Approved' };
  if (s === 'changes_requested') return { cls: 'next-action-red', text: 'Changes requested' };
  if (s === 'commented') return { cls: 'next-action-blue', text: 'Commented' };
  return null;
}

function prReviewStatusTag(pr) {
  const s = pr.myReviewStatus;
  if (!s) return '';
  const map = {
    approved:           ['chip-green',  '✅ Approved'],
    commented:          ['chip-blue',   '💬 Commented'],
    changes_requested:  ['chip-red',    '🚫 Changes requested'],
    review_requested:   ['chip-yellow', '👀 Review requested'],
  };
  const [cls, label] = map[s] || [];
  return cls ? `<span class="chip ${cls}">${label}</span>` : '';
}

function cardNudges(ticket, myPRs) {
  const prs = (myPRs || []).filter(pr => prMatchesTicket(pr, ticket.key));
  const nudges = [];
  const day = 86400000;
  prs.filter(pr => pr.ciStatus === 'failing' && !pr.isDraft).forEach(pr => {
    nudges.push({ cls: 'nudge-red', text: `CI ✗ ${pr.repoName || ''}#${pr.number}` });
  });
  if (ticket.statusCategory === 'In Progress' && !prs.length) {
    nudges.push({ cls: 'nudge-yellow', text: 'No open PR' });
  }
  prs.filter(pr => !pr.isDraft && pr.approvalCount === 0 && pr.updatedAt).forEach(pr => {
    if ((Date.now() - new Date(pr.updatedAt).getTime()) / day >= 3) {
      nudges.push({ cls: 'nudge-yellow', text: `No reviews: #${pr.number}` });
    }
  });
  if (!nudges.length) return '';
  return `<div class="card-nudges">`
    + nudges.map(n => `<span class="nudge ${n.cls}">${escHtml(n.text)}</span>`).join('')
    + `</div>`;
}

function prRow(pr, showAvatar, isMyPR) {
  const { state, html: chipsHtml } = prChips(pr);
  const desc = prDescSnippet(pr.body);
  const descHtml = desc ? `<div class="pr-desc">${escHtml(desc)}</div>` : '';
  const authorLogin = pr.author && pr.author.login;
  const repoName = pr.repoName || (pr.repository && pr.repository.name) || '';
  const locationLabel = repoName ? `${repoName} #${pr.number}` : `#${pr.number}`;
  const promptText = `Let's investigate PR #${pr.number} "${(pr.title || '').replace(/"/g, "'")}" in ${repoName}: ${pr.url}`;
  const askBtn = `<button class="claude-prompt-btn" data-prompt="${escHtml(promptText)}" onclick="event.preventDefault();event.stopPropagation();copyPrompt(this)">`
    + `<div class="prompt-btn-title">✦ Ask Claude...</div>`
    + `<div class="prompt-btn-text">${escHtml(promptText)}</div>`
    + `</button>`;
  const nextAction = prNextAction(pr, isMyPR);
  const nextActionHtml = nextAction ? `<div class="pr-next-action ${escHtml(nextAction.cls)}">${escHtml(nextAction.text)}</div>` : '';
  const reviewTag = prReviewStatusTag(pr);
  const avatarHtml = authorLogin
    ? `<img class="pr-row-avatar" src="https://github.com/${encodeURIComponent(authorLogin)}.png?size=40" alt="${escHtml(authorLogin)}" loading="lazy">`
    : '';
  return `<a class="pr-row pr-row-v2 pr-row-${state}" href="${escHtml(pr.url)}" target="_blank"${pr.isMerged ? ' data-merged="1"' : ''}${pr.isDraft && !pr.isMerged ? ' data-draft="1"' : ''}>`
    + avatarHtml
    + `<div class="pr-row-body">`
    + (authorLogin ? `<div class="pr-row-author-line">@${escHtml(authorLogin)}</div>` : '')
    + `<div class="pr-row-title-line"><span class="pr-dot ${state}"></span><span class="pr-row-location">${escHtml(locationLabel)}</span><span class="pr-title">${escHtml(pr.title || '')}</span></div>`
    + descHtml
    + chipsHtml
    + (reviewTag ? `<div class="pr-review-tag">${reviewTag}</div>` : '')
    + `</div>`
    + `<div class="pr-row-actions">`
    + nextActionHtml
    + askBtn
    + `</div>`
    + `</a>`;
}

function prCountChips(prs, branches = []) {
  const open   = prs.filter(p => !p.isMerged && !p.isDraft).length;
  const draft  = prs.filter(p => p.isDraft && !p.isMerged).length;
  const merged = prs.filter(p => p.isMerged).length;
  const parts = [];
  if (open)            parts.push(`<span class="repo-count repo-count-open">${open} open</span>`);
  if (draft)           parts.push(`<span class="repo-count repo-count-draft">${draft} draft</span>`);
  if (merged)          parts.push(`<span class="repo-count repo-count-merged">${merged} merged</span>`);
  if (branches.length) parts.push(`<span class="repo-count repo-count-branch">${branches.length} branch${branches.length !== 1 ? 'es' : ''}</span>`);
  return parts.length ? parts.join('') : `<span class="repo-count">${prs.length}</span>`;
}

function toggleMyPrsFilter(type) {
  const container = document.getElementById('pr-content');
  if (!container) return;
  const attr = 'data-hide-' + type;
  const isHiding = container.hasAttribute(attr);
  if (isHiding) {
    container.removeAttribute(attr);
    try { localStorage.removeItem('pr-filter-hide-' + type); } catch(e) {}
  } else {
    container.setAttribute(attr, '');
    try { localStorage.setItem('pr-filter-hide-' + type, '1'); } catch(e) {}
  }
  const btn = document.querySelector(`[data-filter-type="${type}"]`);
  if (btn) btn.classList.toggle('active', isHiding);
  _updateEmptyRepoGroups(container);
}

function _updateEmptyRepoGroups(body) {
  if (!body) return;
  const hideOpen     = body.hasAttribute('data-hide-open');
  const hideMerged   = body.hasAttribute('data-hide-merged');
  const hideDraft    = body.hasAttribute('data-hide-draft');
  const hideBranches = body.hasAttribute('data-hide-branches');
  body.querySelectorAll('.pr-repo-group').forEach(group => {
    const rows = group.querySelectorAll('.pr-row');
    const anyVisible = Array.from(rows).some(row => {
      if (row.dataset.branch === '1' && hideBranches) return false;
      if (row.dataset.merged === '1' && hideMerged) return false;
      if (row.dataset.draft  === '1' && hideDraft)  return false;
      if (row.classList.contains('pr-row-open') && hideOpen) return false;
      return true;
    });
    group.style.display = anyVisible ? '' : 'none';
  });
}

function collapseRepos(sectionKey) {
  document.querySelectorAll(`details[data-persist^="${sectionKey}-"]`).forEach(d => {
    d.removeAttribute('open');
    try { localStorage.setItem(d.dataset.persist, 'closed'); } catch(e) {}
  });
}

function expandRepos(sectionKey) {
  document.querySelectorAll(`details[data-persist^="${sectionKey}-"]`).forEach(d => {
    d.setAttribute('open', '');
    try { localStorage.setItem(d.dataset.persist, 'open'); } catch(e) {}
  });
}

function prSection(sectionId, title, icon, prs, groupBy, avatarLogin, opts) {
  opts = opts || {};
  const nestedGroupBy = opts.nestedGroupBy || null;
  const showRowAvatars = opts.showRowAvatars || false;
  groupBy = groupBy || 'repo';
  const count = (prs || []).length;
  const persistKey = 'prs-' + sectionId;
  const isOpen = localStorage.getItem(persistKey) !== 'closed';
  const controls = count > 0
    ? `<span class="pr-section-controls" onclick="event.stopPropagation()">`
      + `<button class="pr-control-btn" onclick="expandRepos('${persistKey}')">Expand all</button>`
      + `<button class="pr-control-btn" onclick="collapseRepos('${persistKey}')">Collapse all</button></span>`
    : '';
  const iconHtml = avatarLogin
    ? `<img class="pr-avatar-hero" src="https://github.com/${encodeURIComponent(avatarLogin)}.png?size=100" alt="${escHtml(avatarLogin)}" loading="lazy">`
    : (icon || '');
  const summaryInner = `<div class="pr-primary-heading"><span class="toggle-arrow">▶</span>${iconHtml} ${escHtml(title)} ${prCountChips(prs || [])}${controls}</div>`;
  if (count === 0) {
    return `<details class="pr-collapsible" data-persist="${persistKey}" ${isOpen ? 'open' : ''}>`
      + `<summary>${summaryInner}</summary>`
      + `<div style="padding:10px 12px;color:var(--text-dim);font-size:12px;margin-top:8px;">No open PRs</div>`
      + `</details>`;
  }
  const byGroup = {};
  (prs || []).forEach(pr => {
    const key = groupBy === 'author'
      ? ((pr.author && pr.author.login) || 'unknown')
      : ((pr.repository && pr.repository.name) || pr.repoName || 'unknown');
    if (!byGroup[key]) byGroup[key] = [];
    byGroup[key].push(pr);
  });
  const groups = Object.entries(byGroup).sort(([a],[b]) => a.localeCompare(b)).map(([key, groupPRs]) => {
    const groupKey = persistKey + '-' + key;
    const groupOpen = localStorage.getItem(groupKey) !== 'closed';
    const headerLabel = groupBy === 'author'
      ? `<img class="pr-avatar-hero" src="https://github.com/${encodeURIComponent(key)}.png?size=100" alt="${escHtml(key)}" loading="lazy"> <span class="repo-link">${escHtml(key)}</span>`
      : `<span class="repo-link">${escHtml(key)}</span>`;
    const prStateOrder = p => p.isMerged ? 2 : (p.isDraft ? 1 : 0);
    const sortedGroup = [...groupPRs].sort((a, b) => prStateOrder(a) - prStateOrder(b));
    let groupBody;
    if (nestedGroupBy) {
      const byNested = {};
      sortedGroup.forEach(pr => {
        const nk = (pr.repository && pr.repository.name) || pr.repoName || 'unknown';
        if (!byNested[nk]) byNested[nk] = [];
        byNested[nk].push(pr);
      });
      const subGroups = Object.entries(byNested).sort(([a],[b]) => a.localeCompare(b)).map(([repo, repoPRs]) =>
        `<div class="pr-nested-group">`
        + `<div class="pr-nested-label">${escHtml(repo)} ${prCountChips(repoPRs)}</div>`
        + `<div class="pr-list">${repoPRs.map(pr => prRow(pr, showRowAvatars)).join('')}</div>`
        + `</div>`
      ).join('');
      groupBody = `<div style="margin-top:8px;padding-left:16px;">${subGroups}</div>`;
    } else {
      groupBody = `<div class="pr-list" style="margin-top:8px;padding-left:16px;">${sortedGroup.map(pr => prRow(pr, showRowAvatars)).join('')}</div>`;
    }
    return `<details class="pr-repo-group" data-persist="${groupKey}" ${groupOpen ? 'open' : ''}>`
      + `<summary><span class="toggle-arrow">▶</span>${headerLabel}${prCountChips(groupPRs)}</summary>`
      + groupBody
      + `</details>`;
  }).join('');
  return `<details class="pr-collapsible" data-persist="${persistKey}" ${isOpen ? 'open' : ''}>`
    + `<summary>${summaryInner}</summary>`
    + `<div style="margin-top:12px;padding-left:16px;">${groups}</div>`
    + `</details>`;
}

function branchRow(branch, org, username) {
  const name     = branch.branch   || '';
  const repo     = branch.repo     || '';
  const daysOld  = branch.daysOld  || 0;
  const aheadBy  = branch.aheadBy  || 0;
  const behindBy = branch.behindBy || 0;
  const base      = `https://github.com/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
  const branchUrl = `${base}/tree/${encodeURIComponent(name)}`;
  const openPrUrl = `${base}/compare/main...${encodeURIComponent(name)}`;
  const promptText = `Let's look at branch ${name} in ${repo} and open a PR: ${branchUrl}`;

  const jiraKey = jiraKeyFromText(name);
  const jiraUrl = jiraKey ? jiraUrlForKey(jiraKey, []) : null;
  const jiraChip = jiraKey
    ? `<a class="chip chip-blue" href="${escHtml(jiraUrl || '#')}" target="_blank" onclick="event.stopPropagation()">${escHtml(jiraKey)}</a>`
    : '';
  const chips = [
    `<span class="chip chip-grey">Branch</span>`,
    jiraChip,
    aheadBy  > 0 ? `<span class="chip chip-green">+${aheadBy} ahead</span>` : '',
    behindBy > 0 ? `<span class="chip chip-yellow">${behindBy} behind</span>` : '',
    `<span class="chip ${daysOld > 30 ? 'chip-orange' : 'chip-grey'}">${daysOld}d old</span>`,
  ].filter(Boolean).join('');

  const avatarHtml = username
    ? `<img class="pr-row-avatar" src="https://github.com/${encodeURIComponent(username)}.png?size=40" alt="${escHtml(username)}" loading="lazy">`
    : '';

  return `<a class="pr-row pr-row-v2" data-branch="1" href="${escHtml(branchUrl)}" target="_blank">`
    + avatarHtml
    + `<div class="pr-row-body">`
    + (username ? `<div class="pr-row-author-line">@${escHtml(username)}</div>` : '')
    + `<div class="pr-row-title-line"><span class="pr-dot branch"></span><span class="pr-row-location">${escHtml(repo)}</span><span class="pr-title">${escHtml(name)}</span></div>`
    + `<div class="pr-chips">${chips}</div>`
    + `</div>`
    + `<div class="pr-row-actions">`
    + `<a class="pr-next-action next-action-blue" href="${escHtml(openPrUrl)}" target="_blank" onclick="event.stopPropagation()">Open PR →</a>`
    + `<button class="claude-prompt-btn" data-prompt="${escHtml(promptText)}" onclick="event.preventDefault();event.stopPropagation();copyPrompt(this)">`
    + `<div class="prompt-btn-title">✦ Ask Claude...</div>`
    + `<div class="prompt-btn-text">${escHtml(promptText)}</div>`
    + `</button>`
    + `</div>`
    + `</a>`;
}

function renderMyPRsSection(data) {
  const myPRs = data.myPRs || [];
  const myMergedPRs = data.myMergedPRs || [];
  const myBranches = data.myBranches || [];
  const allMyPRs = [...myPRs, ...myMergedPRs];
  const tickets = data.jiraTickets || [];
  const username = data.githubUsername || null;
  const org = data.githubOrg || '';
  const persistKey = 'prs-my';
  const isOpen = (() => { try { return localStorage.getItem(persistKey) !== 'closed'; } catch(e) { return true; } })();

  const countAll    = allMyPRs.length;
  const countOpen   = allMyPRs.filter(p => !p.isMerged && !p.isDraft).length;
  const countDraft  = allMyPRs.filter(p => p.isDraft && !p.isMerged).length;
  const merged      = allMyPRs.filter(p => p.isMerged).length;
  const countBranch = myBranches.length;
  const countChips = [
    countAll    ? `<span class="repo-count">${countAll} total</span>` : '',
    countOpen   ? `<span class="repo-count repo-count-open">${countOpen} open</span>` : '',
    countDraft  ? `<span class="repo-count repo-count-draft">${countDraft} draft</span>` : '',
    merged      ? `<span class="repo-count repo-count-merged">${merged} merged</span>` : '',
    countBranch ? `<span class="repo-count repo-count-branch">${countBranch} branch${countBranch !== 1 ? 'es' : ''}</span>` : '',
  ].filter(Boolean).join('');

  const iconHtml = username
    ? `<img class="pr-avatar-hero" src="https://github.com/${encodeURIComponent(username)}.png?size=100" alt="${escHtml(username)}" loading="lazy">`
    : '';
  const controls = countAll > 0
    ? `<span class="pr-section-controls" onclick="event.stopPropagation()">`
      + `<button class="pr-control-btn" onclick="expandRepos('${persistKey}')">Expand all</button>`
      + `<button class="pr-control-btn" onclick="collapseRepos('${persistKey}')">Collapse all</button></span>`
    : '';
  const summaryInner = `<div class="pr-primary-heading"><span class="toggle-arrow">▶</span>${iconHtml} My PRs ${countChips}${controls}</div>`;

  if (countAll === 0 && myBranches.length === 0) {
    return `<details class="pr-collapsible" data-persist="${persistKey}" ${isOpen ? 'open' : ''}>`
      + `<summary>${summaryInner}</summary>`
      + `<div style="padding:10px 12px;color:var(--text-dim);font-size:12px;margin-top:8px;">No open PRs</div>`
      + `</details>`;
  }

  const prStateOrder = p => p.isMerged ? 2 : (p.isDraft ? 1 : 0);

  // Group PRs by repo
  const repoBuckets = {};
  allMyPRs.forEach(pr => {
    const repo = pr.repoName || (pr.repository && pr.repository.name) || 'unknown';
    if (!repoBuckets[repo]) repoBuckets[repo] = { prs: [], branches: [] };
    repoBuckets[repo].prs.push(pr);
  });
  myBranches.forEach(b => {
    const repo = b.repo || 'unknown';
    if (!repoBuckets[repo]) repoBuckets[repo] = { prs: [], branches: [] };
    repoBuckets[repo].branches.push(b);
  });

  const repoNames = Object.keys(repoBuckets).sort((a, b) => {
    // Sort: repos with open PRs first, then alphabetically
    const aOpen = repoBuckets[a].prs.filter(p => !p.isMerged && !p.isDraft).length;
    const bOpen = repoBuckets[b].prs.filter(p => !p.isMerged && !p.isDraft).length;
    if (aOpen !== bOpen) return bOpen - aOpen;
    return a.localeCompare(b);
  });

  const groups = repoNames.map(repo => {
    const { prs, branches } = repoBuckets[repo];
    const groupKey  = persistKey + '-' + repo;
    const groupOpen = (() => { try { return localStorage.getItem(groupKey) !== 'closed'; } catch(e) { return true; } })();
    const sorted    = [...prs].sort((a, b) => prStateOrder(a) - prStateOrder(b));
    return `<details class="pr-repo-group" data-persist="${groupKey}" ${groupOpen ? 'open' : ''}>`
      + `<summary><span class="toggle-arrow">▶</span><span class="repo-link">${escHtml(repo)}</span>${prCountChips(prs, branches)}</summary>`
      + `<div class="pr-list" style="margin-top:8px;padding-left:16px;">`
      + sorted.map(pr => prRow(pr, false, true)).join('')
      + branches.map(b => branchRow(b, org, username)).join('')
      + `</div>`
      + `</details>`;
  }).join('');

  return `<details class="pr-collapsible" data-persist="${persistKey}" ${isOpen ? 'open' : ''}>`
    + `<summary>${summaryInner}</summary>`
    + `<div style="margin-top:8px;padding-left:16px;">${groups}</div>`
    + `</details>`;
}

function renderPRTab() {
  const el = document.getElementById('pr-content');
  if (!el) return;
  const data = window.DASHBOARD_DATA;
  if (!data) {
    el.innerHTML = noDataPlaceholder('📭', 'No PR data loaded');
    return;
  }
  const hideOpen     = (() => { try { return !!localStorage.getItem('pr-filter-hide-open');     } catch(e) { return false; } })();
  const hideMerged   = (() => { try { return !!localStorage.getItem('pr-filter-hide-merged');   } catch(e) { return false; } })();
  const hideDraft    = (() => { try { return !!localStorage.getItem('pr-filter-hide-draft');    } catch(e) { return false; } })();
  const hideBranches = (() => { try { return !!localStorage.getItem('pr-filter-hide-branches'); } catch(e) { return false; } })();
  const filterBar = `<div class="pr-filter-bar">`
    + `<span class="pr-filter-label">Show:</span>`
    + `<button class="pr-filter-btn ${hideOpen     ? '' : 'active'}" data-filter-type="open"     onclick="toggleMyPrsFilter('open')"     >Open</button>`
    + `<button class="pr-filter-btn ${hideDraft    ? '' : 'active'}" data-filter-type="draft"    onclick="toggleMyPrsFilter('draft')"    >Draft</button>`
    + `<button class="pr-filter-btn ${hideMerged   ? '' : 'active'}" data-filter-type="merged"   onclick="toggleMyPrsFilter('merged')"   >Merged</button>`
    + `<button class="pr-filter-btn ${hideBranches ? '' : 'active'}" data-filter-type="branches" onclick="toggleMyPrsFilter('branches')" >Branches</button>`
    + `</div>`;

  ['data-hide-open', 'data-hide-merged', 'data-hide-draft', 'data-hide-branches'].forEach(a => el.removeAttribute(a));
  if (hideOpen)     el.setAttribute('data-hide-open',     '');
  if (hideMerged)   el.setAttribute('data-hide-merged',   '');
  if (hideDraft)    el.setAttribute('data-hide-draft',    '');
  if (hideBranches) el.setAttribute('data-hide-branches', '');

  el.innerHTML = dataTimestamp(data.generatedAt)
    + filterBar
    + renderMyPRsSection(data)
    + prSection('team',     'Team PRs',           '👥', data.teamPRs,    'author', null, { nestedGroupBy: 'repo' })
    + prSection('repo',     'Repo PRs — Non-team','📦', data.repoPRs,    'repo',   null, { showRowAvatars: true })
    + prSection('assigned', 'Assigned to Me',     '👀', data.assignedPRs,'repo',   null, { showRowAvatars: true });

  const total = [data.myPRs, data.teamPRs, data.repoPRs, data.assignedPRs].reduce((s,a) => s + (a||[]).length, 0);
  const prsBtn = document.querySelector('[data-tab="prs"]');
  if (prsBtn) prsBtn.textContent = `PRs (${total})`;
  el.querySelectorAll('details[data-persist]').forEach(d => {
    d.addEventListener('toggle', () => { try { localStorage.setItem(d.dataset.persist, d.open ? 'open' : 'closed'); } catch(e) {} });
  });
  _updateEmptyRepoGroups(el);
}

// ── Skills & Agents tab ────────────────────────────────────────────────────────
function filterSkills(query) {
  const q = query.toLowerCase();
  const cards = document.querySelectorAll('#skills-content .skill-card, #skills-content .agent-card');
  let visible = 0;
  cards.forEach(c => {
    const match = !q
      || (c.dataset.name || '').toLowerCase().includes(q)
      || (c.dataset.desc || '').toLowerCase().includes(q);
    c.classList.toggle('hidden', !match);
    if (match) visible++;
  });
  const noResults = document.getElementById('skills-no-results');
  if (noResults) noResults.style.display = visible === 0 ? 'block' : 'none';
}

function renderSkillsTab() {
  const el = document.getElementById('skills-content');
  if (!el) return;
  const data = window.DASHBOARD_DATA;
  if (!data || !data.claudeData) {
    el.innerHTML = noDataPlaceholder('🧰', 'No Claude data loaded');
    return;
  }
  const { skills, agents } = data.claudeData;
  const total = (skills||[]).length + (agents||[]).length;

  const searchBar = `<input type="text" class="skills-search" id="skills-search-input"
    placeholder="Search skills &amp; agents (${total} total)…"
    oninput="filterSkills(this.value)">`;

  const skillCards = (skills || []).map(s =>
    `<div class="skill-card" data-name="${escHtml(s.name)}" data-desc="${escHtml(s.description)}">`
    + `<div class="skill-name">${escHtml(s.name)}</div>`
    + `<div class="skill-desc">${escHtml(s.description || '—')}</div>`
    + `</div>`
  ).join('');

  const agentCards = (agents || []).map(a =>
    `<div class="agent-card" data-name="${escHtml(a.name)}" data-desc="">`
    + `<div class="agent-name">${escHtml(a.name)}</div>`
    + `</div>`
  ).join('');

  el.innerHTML = searchBar
    + `<div class="skills-section-title">Skills (${(skills||[]).length}) &amp; Agents (${(agents||[]).length})</div>`
    + `<div class="skills-grid">${skillCards}${agentCards}</div>`
    + `<div class="no-results" id="skills-no-results" style="display:none;">No matches.</div>`;
}

// ── Claude tab ─────────────────────────────────────────────────────────────────
function renderClaudeTab() {
  const el = document.getElementById('claude-content');
  if (!el) return;
  const data = window.DASHBOARD_DATA;
  if (!data || !data.claudeData) {
    el.innerHTML = noDataPlaceholder('🤖', 'No Claude data loaded');
    return;
  }
  const { hooks, mcpServers } = data.claudeData;

  const hooksRows = Object.entries(hooks || {})
    .map(([k, v]) => `<tr><td>${escHtml(k)}</td><td>${v}</td></tr>`).join('');
  const hooksSection = `<div class="skills-section-title">Hooks</div>`
    + `<div class="claude-section"><table class="mcp-table">`
    + `<thead><tr><th>Event</th><th>Count</th></tr></thead>`
    + `<tbody>${hooksRows || '<tr><td colspan="2" style="color:var(--text-dim)">No hooks configured</td></tr>'}</tbody></table></div>`;

  const mcpRows = (mcpServers || [])
    .map(s => `<tr><td class="mcp-name">${escHtml(s)}</td></tr>`).join('');
  const mcpSection = `<div class="skills-section-title">MCP Servers (${(mcpServers||[]).length})</div>`
    + `<div class="claude-section"><table class="mcp-table"><tbody>${mcpRows}</tbody></table></div>`;

  el.innerHTML = hooksSection + mcpSection;
}

// ── Team tab ───────────────────────────────────────────────────────────────────
function teamPrRow(pr) {
  const state = pr.isMerged ? 'merged' : (pr.isDraft ? 'draft' : 'open');
  const stateChip = pr.isMerged
    ? '<span class="chip chip-purple">Merged</span>'
    : (pr.isDraft ? '<span class="chip chip-grey">Draft</span>' : '<span class="chip chip-green">Open</span>');
  const repoName  = pr.repoName || (pr.repository && pr.repository.name) || '';
  const label     = repoName ? `${repoName} #${pr.number}` : `#${pr.number}`;
  const ciChip = !pr.isMerged && pr.ciStatus === 'failing'
    ? '<span class="chip chip-red">CI ✗</span>'
    : (!pr.isMerged && pr.ciStatus === 'pending' ? '<span class="chip chip-yellow">CI …</span>' : '');
  const attentionChip = pr.myReviewStatus === 'review_requested'
    ? '<span class="chip chip-yellow">👀 Review me</span>'
    : '';
  return `<a class="team-pr-row" href="${escHtml(pr.url)}" target="_blank">`
    + `<span class="pr-dot ${state}"></span>`
    + `<span class="team-pr-label">${escHtml(label)}</span>`
    + `<span class="team-pr-title">${escHtml(pr.title || '')}</span>`
    + `<span class="team-pr-chips">${stateChip}${ciChip}${attentionChip}</span>`
    + `</a>`;
}

function renderTeamTab() {
  const el = document.getElementById('team-content');
  if (!el) return;
  const data = window.DASHBOARD_DATA;
  if (!data) { el.innerHTML = noDataPlaceholder('👥', 'No data loaded'); return; }
  const teamPRs    = data.teamPRs || [];
  const tickets    = data.jiraTickets || [];
  const oncallData = data.oncallData || [];

  const currentOncall  = oncallData.find(e => e.isCurrent);
  const upcomingOncall = oncallData.filter(e => !e.isCurrent);

  const jiraBase = (() => {
    const t = tickets.find(t => t.url);
    return t ? t.url.replace(/\/browse\/.*$/, '') : '';
  })();

  const cards = TEAM_MEMBERS.map(member => {
    const isOnCall  = !!(currentOncall && member.pdId && currentOncall.userId === member.pdId);
    const nextEntry = member.pdId ? upcomingOncall.find(e => e.userId === member.pdId) : null;

    const memberPRs      = teamPRs.filter(pr => (pr.author && pr.author.login) === member.github);
    const openCount      = memberPRs.filter(p => !p.isMerged && !p.isDraft).length;
    const draftCount     = memberPRs.filter(p => p.isDraft && !p.isMerged).length;
    const mergedCount    = memberPRs.filter(p => p.isMerged).length;
    const attentionCount = memberPRs.filter(p => p.myReviewStatus === 'review_requested').length;

    const countChips = [
      openCount   ? `<span class="repo-count repo-count-open">${openCount} open</span>`       : '',
      draftCount  ? `<span class="repo-count repo-count-draft">${draftCount} draft</span>`    : '',
      mergedCount ? `<span class="repo-count repo-count-merged">${mergedCount} merged</span>` : '',
    ].filter(Boolean).join('') || `<span class="repo-count">0 PRs</span>`;

    const attentionBadge = attentionCount
      ? `<span class="team-attention-badge">👀 ${attentionCount} need${attentionCount === 1 ? 's' : ''} review</span>`
      : '';
    const oncallBadge = isOnCall
      ? `<span class="team-oncall-badge">🔔 On-call</span>`
      : '';
    const notOnRota = !member.pdId || (!isOnCall && !nextEntry && oncallData.length > 0);
    const nextOncallHtml = isOnCall
      ? ''
      : nextEntry
        ? `<div class="team-next-oncall">Next on-call: ${escHtml(oncallDate(nextEntry.start))} <span class="team-next-oncall-rel">(${escHtml(relativeTime(nextEntry.start))})</span></div>`
        : notOnRota
          ? `<div class="team-next-oncall team-not-on-rota">Not on rota</div>`
          : '';

    const githubProfileUrl = `https://github.com/${encodeURIComponent(member.github)}`;
    const ghOrg            = data.githubOrg ? encodeURIComponent(data.githubOrg) : '';
    const githubUrl        = ghOrg
      ? `https://github.com/search?q=org%3A${ghOrg}+is%3Apr+is%3Aopen+author%3A${encodeURIComponent(member.github)}&type=pullrequests`
      : githubProfileUrl;
    const slackUrl      = data.slackBaseUrl && member.slack
      ? `${data.slackBaseUrl}/team/${encodeURIComponent(member.slack)}`
      : '';
    const jiraIssuesUrl = jiraBase && member.jiraId
      ? `${jiraBase}/issues/?jql=assignee%3D${encodeURIComponent(member.jiraId)}%20AND%20statusCategory%20!%3D%20Done%20ORDER%20BY%20priority%20ASC`
      : '';
    const pdUrl = data.pdBaseUrl && member.pdId
      ? `${data.pdBaseUrl}/users/${encodeURIComponent(member.pdId)}/on-call/list`
      : '';

    const iconLinks = [
      `<a class="team-icon-link" href="${escHtml(githubUrl)}" target="_blank" title="GitHub profile"><img src="assets/github.ico" alt="" class="team-icon-img team-icon-img-invert">GitHub</a>`,
      slackUrl ? `<a class="team-icon-link" href="${escHtml(slackUrl)}" target="_blank" title="Slack DM"><img src="assets/slack.ico" alt="" class="team-icon-img">Slack</a>` : '',
      jiraIssuesUrl ? `<a class="team-icon-link" href="${escHtml(jiraIssuesUrl)}" target="_blank" title="Jira issues"><img src="assets/jira.ico" alt="" class="team-icon-img">Jira</a>` : '',
      pdUrl ? `<a class="team-icon-link" href="${escHtml(pdUrl)}" target="_blank" title="PagerDuty profile"><img src="assets/pagerduty.ico" alt="" class="team-icon-img">PagerDuty</a>` : '',
    ].filter(Boolean).join('');

    // Group PRs by Jira key extracted from title or branch name
    const ticketGroups = {};
    const ungrouped = [];
    memberPRs.forEach(pr => {
      const key = jiraKeyFromText(pr.title) || jiraKeyFromText(pr.headRefName || '');
      if (key) {
        if (!ticketGroups[key]) ticketGroups[key] = [];
        ticketGroups[key].push(pr);
      } else {
        ungrouped.push(pr);
      }
    });

    function ticketGroupHtml(key, prs) {
      const ticket  = tickets.find(t => t.key === key);
      const keyUrl  = jiraUrlForKey(key, tickets) || '#';
      const statusChip = ticket ? `<span class="chip chip-grey" style="font-size:10px;padding:1px 5px;">${escHtml(ticket.status)}</span>` : '';
      const summary = ticket ? ticket.summary : '';
      let priorityChip = '';
      if (ticket && ticket.priority) {
        const p = ticket.priority.toLowerCase();
        const cls = (p === 'critical' || p === 'highest') ? 'chip-red'
          : p === 'high'   ? 'chip-orange'
          : p === 'medium' ? 'chip-yellow'
          : 'chip-grey';
        priorityChip = `<span class="chip ${cls}" style="font-size:10px;padding:1px 5px;">${escHtml(ticket.priority)}</span>`;
      }
      let deadlineChip = '';
      if (ticket && ticket.dueDate) {
        const daysLeft = Math.ceil((new Date(ticket.dueDate).getTime() - Date.now()) / 86400000);
        const label = daysLeft < 0
          ? `Overdue ${Math.abs(daysLeft)}d`
          : daysLeft === 0 ? 'Due today'
          : `Due ${daysLeft}d`;
        const cls = daysLeft < 0 ? 'chip-red' : daysLeft <= 7 ? 'chip-orange' : 'chip-yellow';
        deadlineChip = `<span class="chip ${cls}" style="font-size:10px;padding:1px 5px;">⏰ ${escHtml(label)}</span>`;
      }
      return `<div class="team-ticket-group">`
        + `<div class="team-ticket-header">`
        + `<a class="team-ticket-key" href="${escHtml(keyUrl)}" target="_blank" onclick="event.stopPropagation()">${escHtml(key)}</a>`
        + statusChip + priorityChip + deadlineChip
        + (summary ? `<span class="team-ticket-summary">${escHtml(summary)}</span>` : '')
        + `</div>`
        + prs.map(pr => teamPrRow(pr)).join('')
        + `</div>`;
    }

    let prBody;
    if (!memberPRs.length) {
      prBody = `<div class="team-no-prs">No open PRs</div>`;
    } else {
      const grouped = Object.entries(ticketGroups).map(([key, prs]) => ticketGroupHtml(key, prs)).join('');
      const ungroupedHtml = ungrouped.length
        ? `<div class="team-ticket-group">`
          + `<div class="team-ticket-header"><span class="team-ticket-key" style="color:var(--text-dim);">No Ticket</span></div>`
          + ungrouped.map(pr => teamPrRow(pr)).join('')
          + `</div>`
        : '';
      prBody = grouped + ungroupedHtml;
    }

    const avatarUrl = `https://github.com/${encodeURIComponent(member.github)}.png?size=64`;
    return `<div class="team-member-card${isOnCall ? ' team-member-oncall' : ''}">`
      + `<div class="team-member-header">`
      + `<a href="${escHtml(githubProfileUrl)}" target="_blank" class="team-member-avatar-link">`
      + `<img class="team-member-avatar" src="${escHtml(avatarUrl)}" alt="${escHtml(member.name)}" loading="lazy">`
      + `</a>`
      + `<div class="team-member-info">`
      + `<div class="team-member-name"><a href="${escHtml(githubProfileUrl)}" target="_blank" class="team-member-name-link">${escHtml(member.name)}</a>${attentionBadge}${oncallBadge}</div>`
      + `<div class="team-member-meta">${escHtml(member.role)} · <span class="team-member-handle">@${escHtml(member.github)}</span></div>`
      + `<div class="team-member-email"><a href="mailto:${escHtml(member.email)}" class="team-email-link">${escHtml(member.email)}</a></div>`
      + `<div class="team-member-links">${iconLinks}</div>`
      + nextOncallHtml
      + `</div>`
      + `<div class="team-member-counts">${countChips}</div>`
      + `</div>`
      + `<div class="team-member-prs">${prBody}</div>`
      + `</div>`;
  }).join('');

  el.innerHTML = `<div class="team-grid">${cards}</div>`;
}

// ── On-call bar ────────────────────────────────────────────────────────────────
function formatOncallUntil(iso) {
  try {
    const d   = new Date(iso);
    const now = new Date();
    const diffMs = d - now;
    const days   = Math.floor(diffMs / 86400000);
    const time   = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (days === 0) return `today ${time}`;
    if (days === 1) return `tomorrow ${time}`;
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ` ${time}`;
  } catch(e) { return ''; }
}

function relativeTime(iso) {
  if (!iso) return '';
  const diffMs = new Date(iso) - Date.now();
  const days   = Math.ceil(diffMs / 86400000);
  if (days <= 0)  return 'today';
  if (days === 1) return '1d';
  if (days < 7)   return `${days}d`;
  const weeks = Math.round(days / 7);
  if (weeks < 5)  return `${weeks}w`;
  return `${Math.round(days / 30)}mo`;
}

function oncallDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = d.getDate();
  const ord = day % 10 === 1 && day !== 11 ? 'st'
            : day % 10 === 2 && day !== 12 ? 'nd'
            : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'short' });
  const month   = d.toLocaleDateString('en-GB', { month: 'short' });
  const time    = d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${weekday} ${day}${ord} ${month} ${time}`;
}

function renderOncallBar() {
  const el = document.getElementById('oncall-content');
  if (!el) return;
  const data    = window.DASHBOARD_DATA;
  const entries = (data && data.oncallData) || [];
  if (!entries.length) { el.innerHTML = ''; return; }

  function oncallDisplayName(raw) {
    if (!raw || !raw.includes('@')) return raw;
    return raw.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  const current  = entries.find(e => e.isCurrent);
  const upcoming = entries.filter(e => !e.isCurrent);
  const myNext   = upcoming.find(e => e.isMe);

  const currentHtml = current
    ? `<span class="oncall-bar-label">📟 On-call:</span>`
      + `<span class="oncall-entry">`
      + (current.isMe
          ? `<span class="oncall-user is-me">${escHtml(oncallDisplayName(current.userName))} (you)</span>`
          : `<span class="oncall-user">${escHtml(oncallDisplayName(current.userName))}</span>`)
      + `</span>`
    : '';

  const myNextHtml = myNext
    ? `<span class="oncall-sep oncall-divider">|</span>`
      + `<span class="oncall-my-next">Your next: <span class="oncall-my-next-date">${escHtml(oncallDate(myNext.start))}</span>`
      + ` <span class="oncall-my-next-rel">${escHtml(relativeTime(myNext.start))}</span></span>`
    : '';

  const rotationItems = upcoming.map(e => {
    const name = oncallDisplayName(e.userName);
    const date = oncallDate(e.start);
    const cls  = e.isMe ? 'oncall-rot-entry oncall-rot-me' : 'oncall-rot-entry';
    const label = e.isMe ? `${name} (you) on-call from` : `${name} on-call from`;
    return `<span class="${cls}"><span class="oncall-rot-name">${escHtml(label)}</span> <span class="oncall-rot-date">${escHtml(date)}</span></span>`;
  });

  const rotationHtml = rotationItems.length
    ? `<span class="oncall-sep oncall-divider">|</span>`
      + `<span class="oncall-rotation">`
      + rotationItems.join('<span class="oncall-rot-sep">→</span>')
      + `</span>`
    : '';

  el.innerHTML = `<div class="oncall-bar">`
    + currentHtml
    + myNextHtml
    + rotationHtml
    + `</div>`;
}

function formatEventTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch(e) { return ''; }
}

function renderCalendarBar() {
  const el = document.getElementById('calendar-content');
  if (!el) return;
  const data   = window.DASHBOARD_DATA;
  const events = (data && data.calendarEvents) || [];
  if (!events.length) { el.innerHTML = ''; return; }

  const now      = new Date();
  const todayStr = now.toLocaleDateString('en-CA');  // YYYY-MM-DD
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString('en-CA');

  function eventHtml(e) {
    const startTime   = formatEventTime(e.start);
    const isNow       = e.start && e.end && new Date(e.start) <= now && new Date(e.end) > now;
    const isTentative = e.responseStatus === 'tentative' || e.responseStatus === 'needsAction';
    const nowBadge    = isNow ? '<span class="cal-now-badge">Now</span>' : '';
    const meetHtml    = e.isOnline && e.meetLink
      ? `<a class="cal-meet-link" href="${escHtml(e.meetLink)}" target="_blank" onclick="event.stopPropagation()">Meet</a>`
      : '';
    const titleCls = isTentative ? 'cal-event-title cal-tentative' : 'cal-event-title';
    return `<span class="cal-event${isNow ? ' cal-event-now' : ''}">`
      + `<span class="cal-event-time">${escHtml(startTime)}</span>`
      + `<span class="${titleCls}">${escHtml(e.title)}</span>`
      + meetHtml + nowBadge
      + `</span>`;
  }

  const todayEvents    = events.filter(e => e.date === todayStr);
  const tomorrowEvents = events.filter(e => e.date === tomorrowStr);

  const todayHtml = `<div class="cal-day-row">`
    + `<span class="calendar-bar-label">📅 Today</span>`
    + `<div class="cal-day-events">`
    + (todayEvents.length
        ? todayEvents.map(eventHtml).join('<span class="cal-sep">·</span>')
        : `<span class="cal-empty">No meetings</span>`)
    + `</div></div>`;

  const tomorrowHtml = tomorrowEvents.length
    ? `<div class="cal-day-row">`
      + `<span class="calendar-bar-label">Tomorrow</span>`
      + `<div class="cal-day-events">`
      + tomorrowEvents.map(eventHtml).join('<span class="cal-sep">·</span>')
      + `</div></div>`
    : '';

  el.innerHTML = `<div class="calendar-bar">${todayHtml}${tomorrowHtml}</div>`;
}

// ── Nudges ─────────────────────────────────────────────────────────────────────
function renderNudges() {
  const el = document.getElementById('nudges-content');
  if (!el) return;
  const data = window.DASHBOARD_DATA;
  if (!data) return;

  const nudges = [];
  const myPRs = data.myPRs || [];
  const tickets = data.jiraTickets || [];
  const now = Date.now();
  const day = 86400000;

  // CI failing on my PRs
  myPRs.filter(pr => pr.ciStatus === 'failing' && !pr.isDraft).forEach(pr => {
    const repo = pr.repoName || (pr.repository && pr.repository.name) || '';
    nudges.push({ cls: 'nudge-red', text: `CI ✗ ${repo} #${pr.number}`, url: pr.url });
  });

  // Tickets with dueDate within 7 days
  tickets.forEach(t => {
    if (!t.dueDate) return;
    const daysLeft = Math.ceil((new Date(t.dueDate).getTime() - now) / day);
    if (daysLeft <= 7 && daysLeft >= 0) {
      nudges.push({ cls: 'nudge-red', text: `Deadline ${daysLeft}d: ${t.key}`, url: t.url });
    }
  });

  // In-progress tickets with no matching open PR
  tickets.filter(t => t.statusCategory === 'In Progress').forEach(t => {
    const hasPR = myPRs.some(pr => prMatchesTicket(pr, t.key));
    if (!hasPR) nudges.push({ cls: 'nudge-yellow', text: `No PR: ${t.key}`, url: t.url });
  });

  // In-review PRs with 0 approvals stale > 3 days
  myPRs.filter(pr => !pr.isDraft && pr.approvalCount === 0 && pr.updatedAt).forEach(pr => {
    const age = (now - new Date(pr.updatedAt).getTime()) / day;
    if (age >= 3) {
      const repo = pr.repoName || (pr.repository && pr.repository.name) || '';
      nudges.push({ cls: 'nudge-yellow', text: `No reviews: ${repo} #${pr.number}`, url: pr.url });
    }
  });

  // Stale drafts > 5 days
  myPRs.filter(pr => pr.isDraft && pr.updatedAt).forEach(pr => {
    const age = (now - new Date(pr.updatedAt).getTime()) / day;
    if (age >= 5) {
      const repo = pr.repoName || (pr.repository && pr.repository.name) || '';
      nudges.push({ cls: 'nudge-blue', text: `Stale draft: ${repo} #${pr.number}`, url: pr.url });
    }
  });

  if (!nudges.length) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<div class="nudge-bar">`
    + `<span class="nudge-bar-label">Nudges</span>`
    + nudges.map(n => n.url
        ? `<a class="nudge ${n.cls}" href="${escHtml(n.url)}" target="_blank">${escHtml(n.text)}</a>`
        : `<span class="nudge ${n.cls}">${escHtml(n.text)}</span>`
      ).join('')
    + `</div>`;
}


// ── App tab ────────────────────────────────────────────────────────────────────
function renderAppTab() {
  const el = document.getElementById('app-content');
  if (!el) return;
  const data = window.DASHBOARD_DATA;
  if (!data) { el.innerHTML = noDataPlaceholder('🖥️', 'No data loaded'); return; }

  const allRepos = data.primaryRepos || [];
  const org      = data.githubOrg    || '';
  const appData  = data.appData      || {};

  const configRepos = data.configRepos || {};

  const repos = allRepos.filter(r =>
    r in configRepos ||
    (appData[r] && appData[r].deploy && (appData[r].deploy.production || appData[r].deploy.staging))
  );

  if (!repos.length) {
    el.innerHTML = noDataPlaceholder('🖥️', 'No primary repos configured — add primary_repos to config.json');
    return;
  }

  function healthChip(health) {
    if (!health || health === 'unknown') return '';
    const map = { healthy: ['chip-green', '✓ Healthy'], degraded: ['chip-yellow', '⚠ Degraded'],
                  failed: ['chip-red', '✗ Failed'], in_flight: ['chip-yellow', '⟳ Deploying'],
                  locked: ['chip-yellow', '🔒 Locked'] };
    const [cls, label] = map[health] || ['', health];
    return cls ? `<span class="chip ${cls}">${label}</span>` : '';
  }

  function fmtAge(iso) {
    if (!iso) return '';
    const mins = Math.round((Date.now() - new Date(iso)) / 60000);
    if (mins < 60)  return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  }

  function fmtDuration(secs) {
    if (!secs) return '';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? (s > 0 ? `${m}m ${s}s` : `${m}m`) : `${s}s`;
  }

  function personRow(label, avatarUrl, username) {
    const avatar = avatarUrl ? `<img class="app-creator-avatar" src="${escHtml(avatarUrl)}" alt="">` : '';
    return `<div class="app-env-person">`
      + `<span class="app-creator-role">${escHtml(label)}</span>`
      + avatar
      + `<a class="app-creator-link" href="https://github.com/${encodeURIComponent(username)}" target="_blank">@${escHtml(username)}</a>`
      + `</div>`;
  }

  function deployEnvBlock(envData, envLabel) {
    const isStaging = envLabel === 'Staging';
    const labelCls  = `app-env-label${isStaging ? ' app-env-label-staging' : ''}`;

    // No data — still render all 6 rows so subgrid aligns
    if (!envData) {
      const hopLabel = `<span class="${labelCls}">${envLabel}</span>`;
      return `<div class="app-env-block">`
        + `<div class="app-env-header">${hopLabel}</div>`
        + `<div class="app-env-desc"><span class="app-no-data">No data</span></div>`
        + `<div class="app-env-sha-row"></div>`
        + `<div class="app-env-person"></div>`
        + `<div class="app-env-person"></div>`
        + `<div class="app-env-svcs"></div>`
        + `</div>`;
    }

    const rel      = envData.latestRelease || {};
    const inFlight = envData.releaseInFlight;
    const locked   = envData.locked;
    const isAuto   = rel.autodeployed;
    const creator  = rel.creator || {};

    // Row 1 — header
    const hopLink   = envData.deployUrl
      ? `<a class="${labelCls}" href="${escHtml(envData.deployUrl)}" target="_blank">${envLabel}</a>`
      : `<span class="${labelCls}">${envLabel}</span>`;
    const branchTag = envData.trackedBranch
      ? `<span class="app-tracked-branch">(${escHtml(envData.trackedBranch)})</span>` : '';
    const deployedChip = inFlight             ? '<span class="chip chip-yellow" style="font-size:12px;padding:1px 5px;">Deploying</span>'
      : locked                                ? '<span class="chip chip-yellow" style="font-size:12px;padding:1px 5px;">Locked</span>'
      : rel.status === 'failed'               ? '<span class="chip chip-red"    style="font-size:12px;padding:1px 5px;">Failed</span>'
      : rel.status === 'successful'           ? '<span class="chip chip-green"  style="font-size:12px;padding:1px 5px;">Deployed</span>'
      : '';
    const rollbackChip  = rel.isRollback         ? '<span class="chip chip-red"    style="font-size:12px;padding:1px 5px;">↩ Rollback</span>' : '';
    const approvalChip  = rel.waitingForApproval ? '<span class="chip chip-purple" style="font-size:12px;padding:1px 5px;">⏸ Approval</span>' : '';

    // Row 2 — commit description
    const descHtml = rel.commitMessage
      ? `<span class="app-commit-msg">${escHtml(rel.commitMessage)}</span>`
      : `<span class="app-no-data">No releases</span>`;

    // Row 3 — SHA + age + duration + auto/manual chip
    const sha = rel.commitShort || '';
    const age = fmtAge(rel.finishedAt || rel.startedAt);
    const dur = fmtDuration(rel.durationSeconds);
    const autoChip = !rel.status ? ''
      : isAuto ? '<span class="chip chip-green"  style="font-size:12px;padding:1px 5px;">Auto</span>'
      :          '<span class="chip chip-yellow" style="font-size:12px;padding:1px 5px;">Manual</span>';
    const shaRowHtml = sha
      ? `<a class="app-commit-sha" href="${escHtml(rel.commitUrl || '#')}" target="_blank">${escHtml(sha)}</a>`
        + (age ? ` <span class="chip chip-grey" style="font-size:12px;padding:1px 5px;">${age}</span>` : '')
        + (dur ? ` <span class="app-deploy-duration">⏱ ${dur}</span>` : '')
        + autoChip
      : '';

    // Row 4 — who released (deploy creator if manual, commit author if auto)
    // Row 5 — who committed (always shown, even if same person)
    const isManualDeploy  = !isAuto && !!creator.username;
    const releaserUser    = isManualDeploy ? creator.username : rel.commitAuthor;
    const releaserAvatar  = isManualDeploy
      ? (creator.avatarUrl || `https://github.com/${encodeURIComponent(creator.username)}.png?size=18`)
      : rel.commitAuthor ? `https://github.com/${encodeURIComponent(rel.commitAuthor)}.png?size=18` : '';
    const committerUser   = rel.commitAuthor || releaserUser || '';
    const committerAvatar = rel.commitAuthor
      ? `https://github.com/${encodeURIComponent(rel.commitAuthor)}.png?size=18`
      : releaserAvatar;

    const deployerRow = releaserUser   ? personRow('Released by',  releaserAvatar,  releaserUser)   : '';
    const authorRow   = committerUser  ? personRow('Committed by', committerAvatar, committerUser)  : '';

    // Row 6 — services
    const msgs    = (rel.releaseMessages || []).filter(m => m);
    const svcs    = (envData.services || []).filter(s => s.desiredCount > 0);
    const svcHtml = svcs.map(s => {
      const ok        = s.runningCount >= s.desiredCount;
      const deploying = !ok && s.pendingCount > 0;
      const crashed   = s.recentCrashes > 0;
      const cls       = !ok && !deploying ? 'app-svc-bad' : (deploying || crashed) ? 'app-svc-warn' : 'app-svc-ok';
      const leftIcon  = !ok && !deploying ? `<span class="app-svc-icon">✗</span>`
                      : deploying         ? `<span class="app-svc-icon">↻</span>`
                      : crashed           ? `<span class="app-svc-icon">⚡${s.recentCrashes}</span>`
                      :                    `<span class="app-svc-icon">✓</span>`;
      const counts    = deploying ? `${s.runningCount}+${s.pendingCount}/${s.desiredCount}` : `${s.runningCount}/${s.desiredCount}`;
      const metrics   = s.metricsUrl ? `<a class="app-svc-metrics" href="${escHtml(s.metricsUrl)}" target="_blank">📊</a>` : '';
      return `<span class="${cls}">${leftIcon} ${escHtml(s.name)} ${counts}${metrics}</span>`;
    }).join(' ');
    const relMsgs = msgs.map(m => `<div class="app-release-msg">💬 ${escHtml(m)}</div>`).join('');

    return `<div class="app-env-block ${isStaging ? 'app-env-block-staging' : 'app-env-block-prod'}">`
      + `<div class="app-env-header">${hopLink}${branchTag}${deployedChip}${rollbackChip}${approvalChip}</div>`
      + `<div class="app-env-desc">${descHtml}${relMsgs}</div>`
      + `<div class="app-env-sha-row">${shaRowHtml}</div>`
      + `<div class="app-env-person">${deployerRow}</div>`
      + `<div class="app-env-person">${authorRow}</div>`
      + `<div class="app-env-svcs">${svcHtml}</div>`
      + `</div>`;
  }

  const cards = repos.map(repo => {
    const svc     = appData[repo] || {};
    const deploy  = svc.deploy    || {};
    const sentry  = svc.sentry    || {};
    const datadog = svc.datadog   || {};
    const ghUrl   = `https://github.com/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;

    const sentryHtml = sentry.unresolvedHigh != null
      ? (sentry.unresolvedHigh > 0 ? `<span class="chip chip-red">${sentry.unresolvedHigh} high</span>` : '<span class="chip chip-green">Clean</span>')
      : '<span class="app-no-data">No data</span>';

    const ddHtml = datadog.alertCount != null
      ? (datadog.alertCount > 0 ? `<span class="chip chip-red">${datadog.alertCount} alert${datadog.alertCount !== 1 ? 's' : ''}</span>` : '<span class="chip chip-green">All clear</span>')
      : '<span class="app-no-data">No data</span>';

    const hasDeployData = deploy.production || deploy.staging;
    const isConfigRepo  = repo in configRepos;
    const configRepoCfg = configRepos[repo] || {};
    const tier = (deploy.production || deploy.staging || {}).tier;
    const tierChipColour = ['chip-red', 'chip-orange', 'chip-yellow', 'chip-green', 'chip-blue'];
    const tierHtml = tier != null
      ? `<span class="chip ${tierChipColour[tier] || 'chip-grey'}" style="font-size:12px;padding:1px 6px;">tier ${tier}</span>`
      : '';

    const configRepoSection = isConfigRepo
      ? `<div class="app-section-title">${escHtml(configRepoCfg.label || repo)}</div>`
        + `<div class="app-env-section">`
        + (configRepoCfg.production_url ? `<div class="app-env-block app-env-block-prod"><div class="app-env-header"><a class="app-env-label" href="${escHtml(configRepoCfg.production_url)}" target="_blank">Prod</a></div></div>` : '')
        + (configRepoCfg.staging_url    ? `<div class="app-env-block app-env-block-staging"><div class="app-env-header"><a class="app-env-label app-env-label-staging" href="${escHtml(configRepoCfg.staging_url)}" target="_blank">Staging</a></div></div>` : '')
        + `</div>`
      : null;

    return `<div class="app-service-card">`
      + `<div class="app-service-header">`
      + tierHtml
      + `<a class="app-service-name" href="${escHtml(ghUrl)}" target="_blank">${escHtml(repo)}</a>`
      + (isConfigRepo ? '' : healthChip(deploy.health))
      + `</div>`
      + `<div class="app-service-body">`
      + (isConfigRepo
          ? configRepoSection
          : hasDeployData
            ? `<div class="app-section-title">${data.deployFaviconDomain ? `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(data.deployFaviconDomain)}&sz=16" class="app-section-favicon">` : ''} Deployments</div>`
              + `<div class="app-env-section">`
              + deployEnvBlock(deploy.production, 'Prod')
              + deployEnvBlock(deploy.staging,    'Staging')
              + `</div>`
            : `<div class="app-monitor-section"><div class="app-monitor-title">${data.deployFaviconDomain ? `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(data.deployFaviconDomain)}&sz=16" class="app-section-favicon">` : ''} Deployments</div><div class="app-monitor-value"><span class="app-no-data">Run refresh --local</span></div></div>`)
      + (isConfigRepo ? '' : `<div class="app-monitor-section"><div class="app-monitor-title"><img src="https://www.google.com/s2/favicons?domain=sentry.io&sz=16" class="app-section-favicon"> Sentry</div><div class="app-monitor-value">${sentryHtml}</div></div>`)
      + (isConfigRepo ? '' : `<div class="app-monitor-section"><div class="app-monitor-title"><img src="https://www.google.com/s2/favicons?domain=datadoghq.com&sz=16" class="app-section-favicon"> Datadog</div><div class="app-monitor-value">${ddHtml}</div></div>`)
      + `</div>`
      + `</div>`;
  }).join('');

  el.innerHTML = dataTimestamp(data.generatedAt) + `<div class="app-grid">${cards}</div>`;
}

// ── Design System ──────────────────────────────────────────────────────────────
function renderDesignSystem() {
  const el = document.getElementById('design-content');
  if (!el) return;

  const sec = (title, content) =>
    `<div style="margin-bottom:32px;">` +
    `<div class="skills-section-title" style="margin-bottom:14px;">${title}</div>` +
    `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start;">${content}</div>` +
    `</div>`;

  const colorSwatches = ['red','orange','yellow','green','blue','purple'].map(c =>
    `<div style="display:flex;flex-direction:column;gap:5px;align-items:center;min-width:64px;">` +
    `<div style="width:64px;height:28px;background:var(--${c}-bg);border:1px solid var(--${c}-border);border-radius:5px;"></div>` +
    `<div style="width:64px;height:10px;background:var(--${c});border-radius:2px;"></div>` +
    `<div style="font-size:10px;color:var(--text-dim);text-align:center;">${c.charAt(0).toUpperCase()+c.slice(1)}</div>` +
    `</div>`
  ).join('');

  const chips = ['green','red','yellow','blue','orange','purple','grey']
    .map(c => `<span class="chip chip-${c}">${c.charAt(0).toUpperCase()+c.slice(1)}</span>`).join('');

  const badges = [
    ['badge-critical','Critical'],['badge-urgent','Urgent'],['badge-review','Review'],
    ['badge-progress','In Progress'],['badge-blocked','Blocked'],['badge-alert','Alert'],
  ].map(([cls,lbl]) => `<span class="badge ${cls}">${lbl}</span>`).join('');

  const nudges = [
    ['nudge-red','🔴 CI failing'],['nudge-yellow','⚠ Deadline soon'],
    ['nudge-blue','💬 Review request'],['nudge-grey','○ Item'],
  ].map(([cls,lbl]) => `<span class="nudge ${cls}">${lbl}</span>`).join('');

  const ciBadges = [
    ['ci-failing','✗ Failing'],['ci-pending','○ Pending'],
  ].map(([cls,lbl]) => `<span class="ci-badge ${cls}">${lbl}</span>`).join('');

  const nextActions = [
    ['next-action-red','CI Failing'],['next-action-yellow','Needs Review'],
    ['next-action-green','Approved'],['next-action-orange','Blocked'],
    ['next-action-blue','In Progress'],['next-action-grey','Draft'],
  ].map(([cls,lbl]) => `<span class="pr-next-action ${cls}">${lbl}</span>`).join('');

  const prDots = ['open','draft','merged','branch','no-pr'].map(s =>
    `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted);">` +
    `<span class="pr-dot ${s}"></span>${s.charAt(0).toUpperCase()+s.slice(1).replace('-',' ')}</div>`
  ).join('');

  const cardVariants = [
    ['','Default','Standard card'],['critical','Critical','Red top bar'],
    ['urgent','Urgent','Green top bar'],['alert','Alert','Yellow, gradient bg'],
    ['plan','Plan','Purple/blue top bar'],['no-ticket','No Ticket','Dashed border'],
  ].map(([cls,title,desc]) =>
    `<div class="card ${cls}" style="width:140px;flex-shrink:0;">` +
    (cls ? `<span class="no-ticket-label" style="margin-bottom:6px;display:inline-block;">${title.toUpperCase()}</span>` : '') +
    `<div class="card-title">${title}</div>` +
    `<div style="font-size:11px;color:var(--text-dim);margin-top:5px;">${desc}</div>` +
    `</div>`
  ).join('');

  const kanbanHeaders = [
    ['col-critical','Critical'],['col-urgent','Urgent'],['col-review','Review'],
    ['col-progress','In Progress'],['col-backlog','Backlog'],['col-done','Done'],
  ].map(([cls,lbl]) =>
    `<div class="kanban-col-header ${cls}" style="min-width:90px;flex:none;">` +
    `${lbl}<span class="col-count">3</span></div>`
  ).join('');

  const askClaudeBtn =
    `<button class="claude-prompt-btn" style="max-width:280px;" onclick="return false">` +
    `<div class="prompt-btn-title">ASK CLAUDE</div>` +
    `<div class="prompt-btn-text">✦ Let's look at this ticket — what's the status?</div>` +
    `</button>`;

  const branchRowBtn = `<a class="pr-open-pr-btn" href="#" onclick="return false">→ Open PR</a>`;

  const prRowExample =
    `<a class="pr-row pr-row-v2" href="#" onclick="return false" style="max-width:520px;display:flex;">` +
    `<span class="pr-dot open" style="flex-shrink:0;margin-top:4px;"></span>` +
    `<div class="pr-row-body">` +
    `<div class="pr-row-author-line">@username · my-repo #42</div>` +
    `<div class="pr-row-title-line"><span class="pr-title">Add feature X to the API</span></div>` +
    `<div class="pr-chips">` +
    `<span class="chip chip-green">✓ 2</span>` +
    `<span class="chip chip-green">In staging</span>` +
    `<span class="chip chip-grey">main ← feature/my-feature</span>` +
    `</div>` +
    `</div>` +
    `<div class="pr-row-actions"><span class="pr-next-action next-action-yellow">Needs Review</span></div>` +
    `</a>`;

  el.innerHTML =
    `<div style="max-width:900px;">` +
    `<p style="font-size:13px;color:var(--text-muted);margin-bottom:28px;">` +
    `Visual reference for all reusable UI components. Copy classes directly into static cards in <code>work-dashboard.html</code>.` +
    `</p>` +
    sec('Color Tokens', colorSwatches) +
    sec('Chips', chips) +
    sec('Badges', badges) +
    sec('Nudges', nudges) +
    sec('CI Badges', ciBadges) +
    sec('Next Action', nextActions) +
    sec('PR Status Dots', prDots) +
    sec('PR Row', prRowExample) +
    sec('Branch Row', branchRowBtn) +
    sec('Ask Claude Button', askClaudeBtn) +
    sec('Cards', `<div style="display:flex;gap:12px;flex-wrap:wrap;">${cardVariants}</div>`) +
    sec('Kanban Column Headers', `<div style="display:flex;gap:8px;flex-wrap:wrap;">${kanbanHeaders}</div>`) +
    `</div>`;
}

// ── Boot ───────────────────────────────────────────────────────────────────────
const _data = window.DASHBOARD_DATA;
if (_data) {
  updateHeaderStats(_data);
  renderRefreshTimestamps(_data);
  const titleEl = document.getElementById('dashboard-title');
  const subtitleEl = document.getElementById('dashboard-subtitle');
  if (titleEl && _data.dashboardTitle) titleEl.textContent = _data.dashboardTitle;
  if (subtitleEl && _data.dashboardSubtitle) subtitleEl.textContent = _data.dashboardSubtitle;
}
renderOncallBar();
renderCalendarBar();
renderNudges();
renderWorkTab();
renderPRTab();
renderTeamTab();
renderAppTab();
renderSkillsTab();
renderClaudeTab();
renderDesignSystem();
initPersistentDetails();
document.querySelectorAll('.swimlane-cards').forEach(grid => {
  const cols = Math.min(grid.querySelectorAll('.card').length, 7) || 1;
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
});
