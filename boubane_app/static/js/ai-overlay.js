/* ═══════════════════════════════════════════
   BOUBANE AI OVERLAY — Module JS
   S'appuie sur l'API Boubane existante (/api/*)
   ═══════════════════════════════════════════ */
(function () {
  'use strict';

  // ─── State ───
  const state = {
    activityItems: [],
    activityOpen: false,
    suggestions: [
      { icon: '📊', text: 'Analyser mes fichiers', action: 'files' },
      { icon: '📧', text: 'Vérifier mes emails', action: 'emails' },
      { icon: '🌐', text: 'Explorer le web', action: 'web' },
      { icon: '📈', text: 'Voir l\'activité', action: 'activity' },
      { icon: '⚙️', text: 'Configuration', action: 'settings' },
    ],
  };

  // ─── Helpers ───
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  function timeAgo(date) {
    const s = Math.floor((Date.now() - date) / 1000);
    if (s < 60) return 'à l\'instant';
    if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.floor(s / 3600)}h`;
    return `il y a ${Math.floor(s / 86400)}j`;
  }

  // ─── Suggestions Bar ───
  function injectSuggestionsBar() {
    const main = $('.main-content');
    if (!main) return;

    const bar = document.createElement('div');
    bar.className = 'ai-suggestions-bar';
    bar.id = 'ai-suggestions';

    state.suggestions.forEach((s) => {
      const chip = document.createElement('button');
      chip.className = 'ai-suggestion-chip';
      chip.innerHTML = `<span class="chip-icon">${s.icon}</span>${s.text}`;
      chip.addEventListener('click', () => {
        if (typeof window.switchPage === 'function') {
          window.switchPage(s.action);
        }
        toast(`Action : ${s.text}`, 'info');
      });
      bar.appendChild(chip);
    });

    main.insertBefore(bar, main.firstChild);
  }

  // ─── Animated Counters ───
  function animateCounters() {
    $$('.stat-value').forEach((el) => {
      const target = parseInt(el.textContent.replace(/[^0-9]/g, ''), 10) || 0;
      if (target === 0) return;

      el.classList.add('animate');
      let current = 0;
      const step = Math.max(1, Math.ceil(target / 30));
      const timer = setInterval(() => {
        current += step;
        if (current >= target) {
          current = target;
          clearInterval(timer);
        }
        el.textContent = current.toLocaleString('fr-FR');
      }, 40);
    });
  }

  // ─── Activity Feed ───
  function injectActivityFeed() {
    // Toggle button
    const toggle = document.createElement('button');
    toggle.className = 'ai-activity-toggle';
    toggle.id = 'ai-activity-toggle';
    toggle.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
      <span class="toggle-badge" id="ai-activity-badge" style="display:none;">0</span>
    `;
    toggle.addEventListener('click', toggleActivity);
    document.body.appendChild(toggle);

    // Feed panel
    const feed = document.createElement('div');
    feed.className = 'ai-activity-feed';
    feed.id = 'ai-activity-feed';
    feed.innerHTML = `
      <div class="ai-activity-header">
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="ai-dot"></div>
          Activité en direct
        </div>
        <button onclick="window.aiOverlay.toggleActivity()" style="background:none;border:none;color:inherit;cursor:pointer;opacity:0.7;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="ai-activity-list" id="ai-activity-list">
        <div style="padding:20px;text-align:center;color:var(--text-light);font-size:0.8rem;">
          En attente d'activité...
        </div>
      </div>
    `;
    document.body.appendChild(feed);
  }

  function toggleActivity() {
    const feed = $('#ai-activity-feed');
    if (!feed) return;
    state.activityOpen = !state.activityOpen;
    feed.classList.toggle('open', state.activityOpen);
    if (state.activityOpen) {
      const badge = $('#ai-activity-badge');
      if (badge) badge.style.display = 'none';
    }
  }

  function addActivityItem(type, text) {
    const list = $('#ai-activity-list');
    if (!list) return;

    // Remove empty state
    const empty = list.querySelector('div[style*="En attente"]');
    if (empty) empty.remove();

    const item = document.createElement('div');
    item.className = 'ai-activity-item';

    const icons = {
      file: '📄',
      email: '📧',
      web: '🌐',
      agent: '🤖',
    };

    item.innerHTML = `
      <div class="ai-item-icon ${type}">${icons[type] || '📌'}</div>
      <div class="ai-item-text">${text}</div>
      <div class="ai-item-time">${timeAgo(Date.now())}</div>
    `;

    list.insertBefore(item, list.firstChild);

    // Keep max 20 items
    while (list.children.length > 20) {
      list.removeChild(list.lastChild);
    }

    // Update badge
    if (!state.activityOpen) {
      const badge = $('#ai-activity-badge');
      if (badge) {
        const count = parseInt(badge.textContent, 10) || 0;
        badge.textContent = count + 1;
        badge.style.display = 'flex';
      }
    }
  }

  // ─── Quick Actions ───
  function injectQuickActions() {
    const dashboard = $('#page-dashboard');
    if (!dashboard) return;

    const statsRow = dashboard.querySelector('.stats-row');
    if (!statsRow) return;

    const qa = document.createElement('div');
    qa.className = 'ai-quick-actions fade-in delay-2';
    qa.innerHTML = `
      <div class="ai-quick-actions-title">Actions rapides</div>
      <div class="ai-quick-actions-grid">
        <button class="ai-quick-action" onclick="if(window.switchPage)switchPage('files');">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Analyser un fichier
        </button>
        <button class="ai-quick-action" onclick="if(window.switchPage)switchPage('emails');">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M22 7l-10 7L2 7"/></svg>
          Lire mes emails
        </button>
        <button class="ai-quick-action" onclick="if(window.switchPage)switchPage('web');">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
          Naviguer
        </button>
        <button class="ai-quick-action" onclick="if(window.switchPage)switchPage('hermes-chat');">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Chat Hermes
        </button>
      </div>
    `;

    statsRow.parentNode.insertBefore(qa, statsRow.nextSibling);
  }

  // ─── API Polling for Activity ───
  function pollActivity() {
    fetch('/api/agent/stats')
      .then((r) => r.json())
      .then((data) => {
        if (data.files) {
          const el = $('#stat-files');
          if (el) el.textContent = data.files.total.toLocaleString('fr-FR');
        }
        if (data.web) {
          const el = $('#stat-web');
          if (el) el.textContent = data.web.total.toLocaleString('fr-FR');
        }
        if (data.emails) {
          const el = $('#stat-emails');
          if (el) el.textContent = data.emails.total.toLocaleString('fr-FR');
        }
        // Feed from recent_activity
        if (data.recent_activity && data.recent_activity.length > 0) {
          const activities = {
            file_analysis: { type: 'file', icon: '📄' },
            web_visit: { type: 'web', icon: '🌐' },
            email_read: { type: 'email', icon: '📧' },
          };
          data.recent_activity.slice(0, 3).forEach((a) => {
            const mapping = activities[a.action] || { type: 'agent', icon: '🤖' };
            const text = a.details || a.action;
            // Deduplicate: only add if different from last
            if (state._lastActivity !== text) {
              state._lastActivity = text;
              addActivityItem(mapping.type, text);
            }
          });
        }
      })
      .catch(() => {});
  }

  // ─── Toast wrapper ───
  function toast(msg, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
    }
  }

  // ─── Init ───
  function init() {
    injectSuggestionsBar();
    injectActivityFeed();
    injectQuickActions();
    animateCounters();

    // Poll every 10s
    setInterval(pollActivity, 10000);
    pollActivity();

    // Add activity items for demo
    setTimeout(() => addActivityItem('agent', 'Boubane initialisé — agent prêt'), 1000);
    setTimeout(() => addActivityItem('agent', 'Surcouche IA activée'), 2500);
  }

  // Run when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose
  window.aiOverlay = { toggleActivity, addActivityItem, toast };
})();
