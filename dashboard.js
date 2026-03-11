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
  // Only match body when the ticket key appears in a Jira browse URL — prevents
  // false positives from "Related PRs" sections mentioning other tickets.
  const jiraPattern = new RegExp('atlassian\\.net/browse/' + ticketKey, 'i');
  if (jiraPattern.test(pr.body || '')) return true;
  return false;
}

function workCard(ticket, myPRs, myMergedPRs, nextActions, internalPriorities) {
  const prs = (myPRs || []).filter(pr => prMatchesTicket(pr, ticket.key));
  const mergedPRs = (myMergedPRs || []).filter(pr => prMatchesTicket(pr, ticket.key));
  const allPRs = [...prs, ...mergedPRs].sort((a, b) => {
    const order = p => p.isMerged ? 2 : (p.isDraft ? 1 : 0);
    return order(a) - order(b);
  });
  const prListHtml = allPRs.length
    ? '<div class="pr-list">' + allPRs.map(pr => {
        const { state, html: chipsHtml } = prChips(pr);
        const repo = pr.repoName || (pr.repository && pr.repository.name) || '';
        return `<a class="pr-row" href="${escHtml(pr.url)}" target="_blank">`
          + `<span class="pr-dot ${state}"></span>`
          + `<span class="pr-title">${escHtml(repo)} #${pr.number}</span>`
          + chipsHtml
          + `</a>`;
      }).join('') + '</div>'
    : '';
  const labels = (ticket.labels || [])
    .map(l => `<span class="chip chip-grey">${escHtml(l)}</span>`).join('');
  const labelsHtml = labels ? `<div class="pr-chips" style="margin-bottom:10px;">${labels}</div>` : '';
  const resolvedPriority = ((internalPriorities || {})[ticket.key]) || ticket.priority;
  const priorityClass = priorityCardClass(resolvedPriority);
  const cardClass = 'card ' + (priorityClass || deadlineUpgradeClass(ticket, priorityClass));
  const summary = ticket.summary || '';
  const promptText = `Let's look into ${ticket.key}, what can you tell me about this before we start?`;
  const deadlineBanner = hasDeadlineSoon(ticket)
    ? `<div class="deadline-banner">⏰ ${escHtml(formatDeadline(ticket.dueDate))}</div>`
    : '';
  const nextAction = (nextActions || {})[ticket.key] || '';
  const nextActionHtml = nextAction
    ? `<div class="next-action"><strong>Next:</strong> ${escHtml(nextAction)}</div>`
    : '';
  const nudgesHtml = cardNudges(ticket, myPRs);
  return `<div class="${cardClass}">`
    + `<div class="card-header">`
    + `<div class="card-meta">`
    + `<a class="card-ticket-ref" href="${escHtml(ticket.url)}" target="_blank">${escHtml(ticket.key)}</a>`
    + `<div class="card-meta-right">`
    + `<span class="badge ${statusBadgeClass(ticket.status)}">${escHtml(ticket.status)}</span>`
    + priorityBadge(resolvedPriority)
    + `</div>`
    + `</div>`
    + `<a class="card-title card-title-link" href="${escHtml(ticket.url)}" target="_blank">${escHtml(summary)}</a>`
    + `</div>`
    + deadlineBanner
    + labelsHtml
    + promptBtn(promptText)
    + nextActionHtml
    + prListHtml
    + nudgesHtml
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

  function col(label, type, filter) {
    const items = tickets.filter(t => !placed.has(t.key) && filter(t));
    items.forEach(t => placed.add(t.key));
    if (!items.length) return '';
    return `<div class="kanban-col">`
      + `<div class="kanban-col-header col-${type}">${label} <span class="col-count">${items.length}</span></div>`
      + items.map(t => workCard(t, myPRs, myMergedPRs, nextActions, internalPriorities)).join('')
      + `</div>`;
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
    return `<div class="kanban-col">`
      + `<div class="kanban-col-header col-critical">🔴 Critical / Urgent / Deadline <span class="col-count">${sorted.length}</span></div>`
      + sorted.map(t => workCard(t, myPRs, myMergedPRs, nextActions, internalPriorities)).join('')
      + `</div>`;
  }

  return `<details class="work-collapsible" data-persist="${workPersistKey}" ${workIsOpen ? 'open' : ''}>`
    + `<summary><span class="toggle-arrow">▶</span>💼 Work <span class="col-count">${tickets.length}</span></summary>`
    + dataTimestamp(data.generatedAt)
    + `<div class="kanban">`
    + priorityCol()
    + col('👀 In Review',          'review',   t => /review/i.test(t.status))
    + col('🚧 In Progress',        'progress', t => t.statusCategory === 'In Progress')
    + col('📋 Todo &amp; Backlog', 'backlog',  () => true)
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

function prRow(pr, showAvatar) {
  const { state, html: chipsHtml } = prChips(pr);
  const desc = prDescSnippet(pr.body);
  const descHtml = desc ? `<div class="pr-desc">${escHtml(desc)}</div>` : '';
  const avatarLogin = showAvatar && pr.author && pr.author.login;
  const repoName = pr.repoName || (pr.repository && pr.repository.name) || '';
  const promptText = `Let's investigate PR #${pr.number} "${(pr.title || '').replace(/"/g, "'")}" in ${repoName}: ${pr.url}`;
  const askBtn = `<button class="pr-ask-btn" data-prompt="${escHtml(promptText)}" onclick="event.preventDefault();event.stopPropagation();copyPrompt(this)">✦ Ask Claude</button>`;
  if (avatarLogin) {
    return `<a class="pr-row pr-row-with-avatar" href="${escHtml(pr.url)}" target="_blank">`
      + `<img class="pr-row-avatar" src="https://github.com/${encodeURIComponent(avatarLogin)}.png?size=40" alt="${escHtml(avatarLogin)}" loading="lazy">`
      + `<div class="pr-row-content">`
      + `<div class="pr-row-main"><span class="pr-dot ${state}"></span><span class="pr-title">#${pr.number} — ${escHtml(pr.title)}</span><span class="pr-author-tag">@${escHtml(avatarLogin)}</span>${askBtn}</div>`
      + descHtml
      + chipsHtml
      + `</div></a>`;
  }
  return `<a class="pr-row" href="${escHtml(pr.url)}" target="_blank">`
    + `<span class="pr-dot ${state}"></span>`
    + `<span class="pr-title">#${pr.number} — ${escHtml(pr.title)}</span>`
    + askBtn
    + descHtml
    + chipsHtml
    + `</a>`;
}

function prCountChips(prs) {
  const open   = prs.filter(p => !p.isMerged && !p.isDraft).length;
  const draft  = prs.filter(p => p.isDraft && !p.isMerged).length;
  const merged = prs.filter(p => p.isMerged).length;
  const parts = [];
  if (open)   parts.push(`<span class="repo-count repo-count-open">${open} open</span>`);
  if (draft)  parts.push(`<span class="repo-count repo-count-draft">${draft} draft</span>`);
  if (merged) parts.push(`<span class="repo-count repo-count-merged">${merged} merged</span>`);
  return parts.length ? parts.join('') : `<span class="repo-count">${prs.length}</span>`;
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

function renderPRTab() {
  const el = document.getElementById('pr-content');
  if (!el) return;
  const data = window.DASHBOARD_DATA;
  if (!data) {
    el.innerHTML = noDataPlaceholder('📭', 'No PR data loaded');
    return;
  }
  const staleByUrl = new Map();
  [...(data.myPRs || []), ...(data.teamPRs || []), ...(data.repoPRs || []), ...(data.assignedPRs || [])]
    .filter(pr => !pr.isMerged && pr.updatedAt && (Date.now() - new Date(pr.updatedAt).getTime()) > 14 * 86400000)
    .forEach(pr => { if (!staleByUrl.has(pr.url)) staleByUrl.set(pr.url, pr); });
  const stalePRs = [...staleByUrl.values()];
  el.innerHTML = dataTimestamp(data.generatedAt)
    + prSection('my',       'My PRs',             null, data.myPRs,       'repo', data.githubUsername || null)
    + prSection('team',     'Team PRs',           '👥', data.teamPRs,    'author', null, { nestedGroupBy: 'repo' })
    + prSection('repo',     'Repo PRs — Non-team','📦', data.repoPRs,    'repo',   null, { showRowAvatars: true })
    + prSection('assigned', 'Assigned to Me',     '👀', data.assignedPRs,'repo',   null, { showRowAvatars: true })
    + prSection('stale',    'Stale (14d+)',        '🕸️', stalePRs,       'repo',   null, { showRowAvatars: true });
  const total = [data.myPRs, data.teamPRs, data.repoPRs, data.assignedPRs].reduce((s,a) => s + (a||[]).length, 0);
  const prsBtn = document.querySelector('[data-tab="prs"]');
  if (prsBtn) prsBtn.textContent = `PRs (${total})`;
  el.querySelectorAll('details[data-persist]').forEach(d => {
    d.addEventListener('toggle', () => { try { localStorage.setItem(d.dataset.persist, d.open ? 'open' : 'closed'); } catch(e) {} });
  });
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
    nudges.push({ cls: 'nudge-red', text: `CI ✗ ${repo} #${pr.number}` });
  });

  // Tickets with dueDate within 7 days
  tickets.forEach(t => {
    if (!t.dueDate) return;
    const daysLeft = Math.ceil((new Date(t.dueDate).getTime() - now) / day);
    if (daysLeft <= 7 && daysLeft >= 0) {
      nudges.push({ cls: 'nudge-red', text: `Deadline ${daysLeft}d: ${t.key}` });
    }
  });

  // In-progress tickets with no matching open PR
  tickets.filter(t => t.statusCategory === 'In Progress').forEach(t => {
    const hasPR = myPRs.some(pr => prMatchesTicket(pr, t.key));
    if (!hasPR) nudges.push({ cls: 'nudge-yellow', text: `No PR: ${t.key}` });
  });

  // In-review PRs with 0 approvals stale > 3 days
  myPRs.filter(pr => !pr.isDraft && pr.approvalCount === 0 && pr.updatedAt).forEach(pr => {
    const age = (now - new Date(pr.updatedAt).getTime()) / day;
    if (age >= 3) {
      const repo = pr.repoName || (pr.repository && pr.repository.name) || '';
      nudges.push({ cls: 'nudge-yellow', text: `No reviews: ${repo} #${pr.number}` });
    }
  });

  // Stale drafts > 5 days
  myPRs.filter(pr => pr.isDraft && pr.updatedAt).forEach(pr => {
    const age = (now - new Date(pr.updatedAt).getTime()) / day;
    if (age >= 5) {
      const repo = pr.repoName || (pr.repository && pr.repository.name) || '';
      nudges.push({ cls: 'nudge-blue', text: `Stale draft: ${repo} #${pr.number}` });
    }
  });

  if (!nudges.length) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<div class="nudge-bar">`
    + `<span class="nudge-bar-label">Nudges</span>`
    + nudges.map(n => `<span class="nudge ${n.cls}">${escHtml(n.text)}</span>`).join('')
    + `</div>`;
}

function transformPromptBtns() {
  document.querySelectorAll('.claude-prompt-btn').forEach(btn => {
    if (btn.querySelector('.prompt-btn-title')) return;
    const text = (btn.textContent || '').replace(/^✦\s*/, '').trim();
    btn.innerHTML = `<div class="prompt-btn-title">✦ Ask Claude...</div>`
      + (text ? `<div class="prompt-btn-text">${escHtml(text)}</div>` : '');
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────────
const _data = window.DASHBOARD_DATA;
if (_data) {
  updateHeaderStats(_data);
  const titleEl = document.getElementById('dashboard-title');
  const subtitleEl = document.getElementById('dashboard-subtitle');
  if (titleEl && _data.dashboardTitle) titleEl.textContent = _data.dashboardTitle;
  if (subtitleEl && _data.dashboardSubtitle) subtitleEl.textContent = _data.dashboardSubtitle;
}
renderNudges();
renderWorkTab();
renderPRTab();
renderSkillsTab();
renderClaudeTab();
initPersistentDetails();
transformPromptBtns();
document.querySelectorAll('.swimlane-cards').forEach(grid => {
  const cols = Math.min(grid.querySelectorAll('.card').length, 7) || 1;
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
});
