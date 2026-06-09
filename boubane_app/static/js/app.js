/**
 * BOUBANE AGENT — Frontend v3
 * Clean architecture · Mail-first UX · Keyboard driven
 */
(function() {
  'use strict';

  /* ═══ CONSTANTS ═══ */
  const API = window.location.pathname.startsWith('/boubane') ? '/boubane' : '';
  const MH  = '/api/himalaya';
  const AV_COLORS = ['#8B7355','#22c55e','#3b82f6','#a855f7','#ef4444','#eab308','#06b6d4','#f97316'];

  /* ═══ STATE ═══ */
  let curPage = 'dashboard', mailSelId = null, chatMsgs = [];
  const snippetCache = {}, fileCache = [];

  const mail = {
    all: [], selected: new Set(), folder: 'INBOX', folders: [],
    search: '', sort: 'date-desc', listEl: null, detailEl: null
  };

  let calWeekOffset = 0, autoConfigCache = null, clientFilterStatus = 'all';

  /* ═══ INIT ═══ */
  document.addEventListener('DOMContentLoaded', () => {
    mail.listEl  = document.getElementById('mail-list-inner');
    mail.detailEl = document.getElementById('mail-detail-pane');
    initNav(); initUpload(); initKeyboard();
    loadStats(); loadActivity(); loadDashEmails(); loadFiles();
    setInterval(loadStats, 30000);
    setInterval(loadActivity, 60000);
  });

  /* ═══════════════════════════════════════════
     UTILS
     ═══════════════════════════════════════════ */
  const $ = id => document.getElementById(id);

  async function api(url, opts = {}) {
    const r = await fetch(url.startsWith('/api/') ? API + url : url, { headers:{'Content-Type':'application/json'}, ...opts });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  function esc(s) { const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }

  function fmtSize(b) {
    if (!b) return '0 o';
    if (b < 1024) return b + ' o';
    if (b < 1048576) return (b/1024).toFixed(1) + ' Ko';
    return (b/1048576).toFixed(1) + ' Mo';
  }

  function fmtDate(s) {
    if (!s) return '';
    const d = new Date((typeof s === 'number' ? s*1000 : s).toString().replace(' ','T'));
    if (isNaN(d.getTime())) return '';
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return "À l'instant";
    if (diff < 3600000) return `Il y a ${Math.floor(diff/60000)}min`;
    if (diff < 86400000) return `Il y a ${Math.floor(diff/3600000)}h`;
    if (diff < 172800000) return 'Hier';
    return d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
  }

  function avColor(n) {
    let h=0; for(let i=0;i<(n||'').length;i++) h=n.charCodeAt(i)+((h<<5)-h);
    return AV_COLORS[Math.abs(h)%AV_COLORS.length];
  }
  // toast removed — silent UX
  function toast(msg, type = 'info') {}

  function sanitize(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rem = [];
    const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
    while (w.nextNode()) {
      const el = w.currentNode, tag = el.tagName.toLowerCase();
      if (['script','iframe','object','embed','form','input','textarea','link','meta','head','base','frame','frameset'].includes(tag)) { rem.push(el); continue; }
      Array.from(el.attributes).forEach(a => { if (a.name.toLowerCase().startsWith('on')||a.value.toLowerCase().startsWith('javascript:')) el.removeAttribute(a.name); });
      if (tag==='a' && el.getAttribute('href')) { el.setAttribute('target','_blank'); el.setAttribute('rel','noopener'); }
      if (tag==='img' && (!el.getAttribute('src') || el.getAttribute('src').startsWith('javascript:'))) el.removeAttribute('src');
    }
    rem.forEach(el => el.parentNode?.removeChild(el));
    return doc.body.innerHTML;
  }

  /* ═══════════════════════════════════════════
     NAVIGATION
     ═══════════════════════════════════════════ */
  function initNav() {
    document.querySelectorAll('.nav-item[data-page]').forEach(el => el.addEventListener('click', () => go(el.dataset.page)));
  }

  window.go = function(page) {
    if (!page) return;
    curPage = page;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
    document.querySelectorAll('.page').forEach(s => s.classList.toggle('active', s.id === 'page-' + page));
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('show');
    // Lazy load
    if (page === 'files')      loadFiles();
    if (page === 'web')        loadWebHistory();
    if (page === 'emails')     { mailLoadFolders(); mailRefresh(); initMailScroll(); }
    if (page === 'activity')   loadActivity();
    if (page === 'settings')   loadAgentStatus();
    if (page === 'business')   loadBusinessOverview();
    if (page === 'clients')    loadClients('all');
    if (page === 'site')       loadSiteStatus();
    if (page === 'calendar')   { calWeekOffset = 0; loadCalendar(); }
    if (page === 'auto-reply') { loadAutoConfig(); loadAutoLog(); }
    if (page === 'agent-chat') { setTimeout(() => $('chat-input')?.focus(), 100); }
  };

  window.toggleSidebar = function() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('show');
  };

  // ─── Mobile touch swipe to go back from mail detail ───
  let touchStartX = 0, touchStartY = 0, touchTracking = false;
  function initTouchSwipe() {
    document.addEventListener('touchstart', e => {
      if (!window.matchMedia('(max-width:1024px)').matches) return;
      const detail = document.getElementById('mail-detail-pane');
      if (!detail || !detail.classList.contains('mobile-show')) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchTracking = true;
    }, { passive: true });
    document.addEventListener('touchend', e => {
      if (!touchTracking) return;
      touchTracking = false;
      const detail = document.getElementById('mail-detail-pane');
      if (!detail || !detail.classList.contains('mobile-show')) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (dx > 60 && Math.abs(dy) < 100 && touchStartX < 40) {
        mailGoBack();
      }
    }, { passive: true });
  }
  initTouchSwipe();

  // ─── Pull-to-refresh on mobile ───
  let pullStartY = 0, pullTracking = false;
  function initPullToRefresh() {
    const pane = $('mail-list-pane');
    if (!pane) return;
    pane.addEventListener('touchstart', e => {
      if (!window.matchMedia('(max-width:1024px)').matches) return;
      if (pane.scrollTop > 0) return;
      pullStartY = e.touches[0].clientY;
      pullTracking = true;
    }, { passive: true });
    pane.addEventListener('touchmove', e => {
      if (!pullTracking) return;
      const dy = e.touches[0].clientY - pullStartY;
      if (dy > 60 && pane.scrollTop <= 0) {
        const ind = $('mail-pull-indicator');
        if (ind) ind.classList.add('visible');
      }
    }, { passive: true });
    pane.addEventListener('touchend', e => {
      if (!pullTracking) return;
      pullTracking = false;
      const dy = e.changedTouches[0].clientY - pullStartY;
      const ind = $('mail-pull-indicator');
      if (ind) ind.classList.remove('visible');
      if (dy > 80 && pane.scrollTop <= 0 && curPage === 'emails') {
        mailRefresh();
      }
    }, { passive: true });
  }
  // Init pull-to-refresh when mail page loads
  const _origMailRefresh = mailRefresh;
  mailRefresh = function(...args) {
    initPullToRefresh();
    return _origMailRefresh.apply(this, args);
  };

  /* ═══════════════════════════════════════════
     KEYBOARD SHORTCUTS
     ═══════════════════════════════════════════ */
  function initKeyboard() {
    document.addEventListener('keydown', e => {
      const tag = e.target.tagName.toLowerCase();
      const inInput = tag === 'input' || tag === 'textarea' || tag === 'select';

      // Ctrl+K = search
      if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (curPage === 'emails') $('mail-search-input')?.focus();
        else go('emails');
        return;
      }

      // Ctrl+Enter = send
      if (e.key === 'Enter' && e.ctrlKey && inInput) {
        if (document.activeElement === $('compose-body'))  mailComposeSend();
        if (document.activeElement === $('mail-reply-textarea') && mailSelId) mailSendReply(mailSelId);
        e.preventDefault(); return;
      }

      if (inInput) return; // Don't handle shortcuts when typing

      // Global
      switch(e.key.toLowerCase()) {
        case 'c': if (curPage === 'emails') mailCompose(); break;
        case '/': e.preventDefault(); if(curPage!=='emails') go('emails'); $('mail-search-input')?.focus(); break;
        case 'g': // g+q = Dashboard
          break;
      }

      // Mail-specific shortcuts (only when on emails page and mail selected)
      if (curPage === 'emails' && mailSelId) {
        switch(e.key.toLowerCase()) {
          case 'r': e.preventDefault(); mailToggleReply(); break;
          case 'a': case 'e': e.preventDefault(); mailArchiveOne(mailSelId); break;
          case 'delete': case 'backspace': e.preventDefault(); mailDeleteOne(mailSelId); break;
          case 'f': e.preventDefault(); mailFwd(mailSelId); break;
          case 's': e.preventDefault(); mailToggleStar(mailSelId, null); break;
          case 'i': e.preventDefault(); mailToggleReply(); break;
          case 'j': e.preventDefault(); mailNavigate(1); break;
          case 'k': e.preventDefault(); mailNavigate(-1); break;
          case 'escape': e.preventDefault(); mailGoBack(); break;
        }
      }
      // F5 = refresh mail
      if (e.key === 'F5' && curPage === 'emails') {
        e.preventDefault();
        mailRefresh();
      }
    });
  }

  // Navigate mail list with j/k
  function mailNavigate(dir) {
    if (!mail.filtered.length) return;
    const idx = mail.filtered.findIndex(m => m.id === mailSelId);
    const next = mail.filtered[Math.max(0, Math.min(mail.filtered.length - 1, idx + dir))];
    if (next) mailOpen(next.id, null);
  }

  /* ═══════════════════════════════════════════
     STATS
     ═══════════════════════════════════════════ */
  async function loadStats() {
    try {
      const s = await api('/api/agent/stats').catch(() => null);
      if (s && $('stat-files'))    $('stat-files').textContent = s?.files?.total ?? 0;
      if (s && $('stat-web'))     $('stat-web').textContent = s?.web?.total ?? 0;
      if (s && $('stat-actions')) $('stat-actions').textContent = s?.total_actions ?? 0;
      const fb = $('nav-file-badge');
      if (fb && s) fb.textContent = s?.files?.total ?? 0;
    } catch(e) {}

    try {
      const em = await api(`${MH}/envelopes?limit=50&folder=INBOX`);
      const envs = em.envelopes || [];
      const unread = envs.filter(e => !(e.flags||[]).includes('Seen')).length;
      if ($('stat-emails')) $('stat-emails').textContent = envs.length;
      const ul = $('stat-unread-label');
      if (ul) ul.textContent = `${unread} non lus`;
      const nb = $('nav-email-badge');
      if (nb) { nb.textContent = unread; nb.style.display = unread > 0 ? 'inline' : 'none'; }
      // Update document title with unread count
      if (unread > 0) document.title = `(${unread}) Boubane — Agent IA`;
      else document.title = 'Boubane — Agent IA';
    } catch(e) {}
  }

  /* ═══════════════════════════════════════════
     DASHBOARD
     ═══════════════════════════════════════════ */
  async function loadDashEmails() {
    try {
      const d = await api(`${MH}/envelopes?limit=10&folder=INBOX`);
      const envs = d.envelopes || [];
      const c = $('dash-email-list');
      if (!c) return;
      if (!envs.length) { c.innerHTML = '<div class="empty-state"><p>Aucun email</p></div>'; return; }
      c.innerHTML = envs.map(e => {
        const sender = (e.from||'').split('<')[0].trim() || e.from || '';
        const read = (e.flags||[]).includes('Seen');
        return `<div class="dash-email-row" onclick="go('emails');setTimeout(()=>mailOpen('${esc(e.id)}',null),400)">
          <div class="dash-email-dot ${read?'read':''}"></div>
          <div class="dash-email-sender">${esc(sender)}</div>
          <div class="dash-email-subject">${esc(e.subject||'(sans objet)')}</div>
          <div class="dash-email-time">${fmtDate(e.date)}</div>
        </div>`;
      }).join('');
    } catch(e) {
      const c = $('dash-email-list');
      if (c) c.innerHTML = '<div class="empty-state"><p>Boîte mail inaccessible</p></div>';
    }
  }

  async function loadActivity() {
    try {
      const d = await api('/api/agent/activity?limit=30');
      ['full-activity-list','dash-activity-list'].forEach((cid, i) => {
        const c = $(cid); if (!c) return;
        const items = (d.activity||[]).slice(0, i === 0 ? 30 : 10);
        if (!items.length) { c.innerHTML = '<div class="empty-state"><p>Aucune activité</p></div>'; return; }
        c.innerHTML = items.map(it => {
          const dot = it.status==='success'?'green':it.status==='error'?'red':'purple';
          return `<div class="activity-item">
            <div class="activity-dot ${dot}"></div>
            <div><div class="activity-text"><strong>${esc(it.action)}</strong> — ${esc(it.details||'')}</div>
            <div class="activity-time">${it.time?new Date(it.time).toLocaleString('fr-FR'):''}</div></div>
          </div>`;
        }).join('');
      });
    } catch(e) {}
  }

  /* ═══════════════════════════════════════════
     FILES
     ═══════════════════════════════════════════ */
  function initUpload() {
    const zone = $('upload-zone'), input = $('file-input');
    if (!zone || !input) return;
    input.addEventListener('change', e => { if(e.target.files.length) handleFiles(e.target.files); });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragover'); if(e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
  }

  async function handleFiles(files) {
    for (const f of files) {
      const fd = new FormData(); fd.append('file', f);
      try { await fetch(API+'/api/files/upload',{method:'POST',body:fd}); toast(`✓ ${f.name}`, 'success'); }
      catch(e) { toast('✗ '+e.message, 'error'); }
    }
    loadFiles(); loadStats();
  }

  async function loadFiles() {
    try {
      const d = await api('/api/files/list?limit=20');
      const files = d.files || [];
      ['file-list','dash-file-list'].forEach((cid, i) => {
        const c = $(cid); if (!c) return;
        const list = i === 0 ? files : files.slice(0,5);
        if (!list.length) { c.innerHTML = '<div class="empty-state"><p>Aucun fichier</p></div>'; return; }
        c.innerHTML = list.map(f => {
          const ext = (f.file_type||'').toLowerCase();
          return `<div class="file-item" onclick="fileViewerOpen(${f.id})" style="cursor:pointer">
            <div class="file-icon">${ext.substring(0,3)}</div>
            <div class="file-info"><div class="file-name">${esc(f.original_name||f.filename)}</div>
            <div class="file-meta">${fmtSize(f.file_size)}</div></div></div>`;
        }).join('');
      });
    } catch(e) {}
  }

  /* ═══════════════════════════════════════════
     WEB
     ═══════════════════════════════════════════ */
  window.browseWeb = async function() {
    const url = $('web-url').value.trim();
    if (!url) { toast('Entrez une URL', 'warning'); return; }
    const el = $('web-result');
    el.innerHTML = '<div class="spinner" style="margin:2rem auto"></div>';
    try {
      const d = await api('/api/web/browse',{method:'POST',body:JSON.stringify({url,task_type:$('web-task-type').value})});
      el.textContent = d.status==='done'?(d.result||'Aucun contenu'):`Erreur: ${d.error||'?'}`;
      toast(d.status==='done'?'✓ Fait':'Erreur', d.status==='done'?'success':'error');
      loadWebHistory(); loadStats();
    } catch(e) { el.textContent = `Erreur: ${e.message}`; }
  };

  async function loadWebHistory() {
    try {
      const d = await api('/api/web/tasks?limit=10');
      const c = $('web-history'); if (!c || !d.tasks?.length) { if(c) c.innerHTML='<div class="empty-state"><p>Aucune page</p></div>'; return; }
      c.innerHTML = d.tasks.map(t => `<div class="activity-item">
        <div class="activity-dot ${t.status==='done'?'green':'yellow'}"></div>
        <div><div class="activity-text"><strong>${esc(t.type)}</strong> — ${esc((t.url||'').substring(0,50))}</div>
        <div class="activity-time">${t.status}</div></div>
      </div>`).join('');
    } catch(e) {}
  }

  /* ═══════════════════════════════════════════
     SVG ICONS (inline, no emoji)
     ═══════════════════════════════════════════ */
  const ICONS = {
    // Navigation
    back:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
    forward:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
    // Actions
    reply:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>`,
    replyAll:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 17 12 12 17 7"/><path d="M10 18v-2a4 4 0 00-4-4H4"/></svg>`,
    send:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
    archive:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`,
    trash:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`,
    star:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    starFilled:`<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    more:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>`,
    close:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    compose:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    search:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    refresh:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>`,
    check:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    inbox:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>`,
    file:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`,
    paperclip: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>`,
    // Status
    read:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
    unread:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/></svg>`,
    // AI sparkle (geometric, no emoji)
    sparkle:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M19 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z"/></svg>`,
    burger:    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
    download:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    external:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    ai:        `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M12 6v2"/><path d="M12 16v2"/><path d="M8 12H6"/><path d="M18 12h-2"/><path d="M8.5 8.5l1.5 1.5"/><path d="M14 14l1.5 1.5"/><path d="M8.5 15.5l1.5-1.5"/><path d="M14 10l1.5-1.5"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>`,
    brain:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 01-4.96.44 2.5 2.5 0 01-2.96-3.08 3 3 0 01-.34-5.58 2.5 2.5 0 011.32-4.24 2.5 2.5 0 011.98-3A2.5 2.5 0 019.5 2z"/><path d="M14.5 2A2.5 2.5 0 0012 4.5v15a2.5 2.5 0 004.96.44 2.5 2.5 0 002.96-3.08 3 3 0 00.34-5.58 2.5 2.5 0 00-1.32-4.24 2.5 2.5 0 00-1.98-3A2.5 2.5 0 0014.5 2z"/></svg>`,
    task:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`,
  };

  // ─── Gmail folder name translations ───
  const FOLDER_FR = {
    'INBOX': 'Boîte de réception',
    '[Gmail]/All Mail': 'Tous les messages',
    '[Gmail]/Sent Mail': 'Messages envoyés',
    '[Gmail]/Drafts': 'Brouillons',
    '[Gmail]/Spam': 'Spam',
    '[Gmail]/Trash': 'Corbeille',
    '[Gmail]/Starred': 'Favoris',
    '[Gmail]/Important': 'Important',
    'Sent': 'Messages envoyés',
    'Drafts': 'Brouillons',
    'Spam': 'Spam',
    'Trash': 'Corbeille',
    'Junk': 'Indésirables',
    'Archive': 'Archives',
  };
  function folderFr(name) { return FOLDER_FR[name] || name.replace('[Gmail]/','').replace(' Mail',''); }

  async function mailLoadFolders() {
    try {
      const d = await api(`${MH}/folders`);
      mail.folders = (d.folders||[]).map(f => typeof f==='string'?{name:f}:f);
      const html = mail.folders.map(f => `<option value="${esc(f.name)}">${esc(folderFr(f.name))}</option>`).join('');
      const sd = $('mail-folder-select');
      if (sd) sd.innerHTML = html;
      const sm = $('mail-folder-select-mobile');
      if (sm) sm.innerHTML = html;
    } catch(e) {}
  }

  let mailLoadOffset = 0, mailLoadTotal = 0, mailLoadingMore = false;

  // ─── Ultra-fast mail loading with localStorage cache ───
  async function mailRefresh(showLoader) {
    if (showLoader !== false && mail.listEl) mail.listEl.innerHTML = '<div class="mail-list-loading"><div class="spinner"></div></div>';
    mail.selected.clear(); mailUpdateBulk();
    mailLoadOffset = 0; mailLoadTotal = 0; mailLoadingMore = false;

    // 1) Instant render from cache (skip loader if cached)
    const cacheKey = `boubane_mails_${mail.folder}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.folder === mail.folder && Date.now() - parsed.ts < 300000) {
          mail.all = parsed.mails;
          mailLoadOffset = parsed.offset || parsed.mails.length;
          mailLoadTotal = parsed.total || parsed.mails.length;
          mailApplyFilters();
          const l = $('mail-count-label');
          if (l) l.textContent = `${mail.filtered.length} / ${mailLoadTotal} msg`;
          // Don't show loader if we have cache
          showLoader = false;
        }
      } catch(e) {}
    }

    // 2) Background fetch (lightweight: 20 first, then full)
    try {
      const d = await api(`${MH}/envelopes?limit=20&folder=${encodeURIComponent(mail.folder)}`);
      mail.all = (d.envelopes||[]).map(e => ({
        id: String(e.id), sender: e.from||'', subject: e.subject||'(sans objet)',
        is_read: (e.flags||[]).includes('Seen'), is_flagged: (e.flags||[]).includes('Flagged'),
        flags: e.flags||[], date: e.date||''
      }));
      mailLoadOffset = mail.all.length;
      mailLoadTotal = parseInt(d.total || mail.all.length);
      mailApplyFilters();
      const l = $('mail-count-label');
      if (l) l.textContent = `${mail.filtered.length} / ${mailLoadTotal} msg`;
      // Save to cache
      localStorage.setItem(cacheKey, JSON.stringify({
        folder: mail.folder, mails: mail.all, offset: mailLoadOffset, total: mailLoadTotal, ts: Date.now()
      }));

      // 3) Load rest in background
      if (mailLoadTotal > mailLoadOffset) {
        api(`${MH}/envelopes?limit=200&folder=${encodeURIComponent(mail.folder)}`).then(d2 => {
          mail.all = (d2.envelopes||[]).map(e => ({
            id: String(e.id), sender: e.from||'', subject: e.subject||'(sans objet)',
            is_read: (e.flags||[]).includes('Seen'), is_flagged: (e.flags||[]).includes('Flagged'),
            flags: e.flags||[], date: e.date||''
          }));
          mailLoadOffset = mail.all.length;
          mailLoadTotal = parseInt(d2.total || mail.all.length);
          mailApplyFilters();
          const l2 = $('mail-count-label');
          if (l2) l2.textContent = `${mail.filtered.length} / ${mailLoadTotal} msg`;
          localStorage.setItem(cacheKey, JSON.stringify({
            folder: mail.folder, mails: mail.all, offset: mailLoadOffset, total: mailLoadTotal, ts: Date.now()
          }));
        }).catch(()=>{});
      }
    } catch(e) {
      if (mail.listEl && !mail.all.length) mail.listEl.innerHTML = `<div class="mail-list-empty"><p>Erreur: ${esc(e.message)}</p></div>`;
    }
  }

  // Infinite scroll: load more when reaching bottom
  function mailScrollHandler() {
    const pane = $('mail-list-pane');
    if (!pane || mailLoadingMore || mailLoadOffset >= mailLoadTotal) return;
    if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 100) {
      mailLoadingMore = true;
      api(`${MH}/envelopes?limit=50&offset=${mailLoadOffset}&folder=${encodeURIComponent(mail.folder)}`)
        .then(d => {
          if (!d.envelopes?.length) { mailLoadingMore = false; return; }
          const more = d.envelopes.map(e => ({
            id: String(e.id), sender: e.from||'', subject: e.subject||'(sans objet)',
            is_read: (e.flags||[]).includes('Seen'), is_flagged: (e.flags||[]).includes('Flagged'),
            flags: e.flags||[], date: e.date||''
          }));
          mail.all.push(...more);
          mailLoadOffset += more.length;
          mailApplyFilters();
          const l = $('mail-count-label');
          if (l) l.textContent = `${mail.filtered.length} / ${mailLoadTotal} msg`;
          mailLoadingMore = false;
        })
        .catch(() => { mailLoadingMore = false; });
    }
  }

  function mailApplyFilters() {
    let list = [...mail.all];
    // Search
    if (mail.search) { const q = mail.search.toLowerCase(); list = list.filter(e => ((e.subject||'')+' '+(e.sender||'')).toLowerCase().includes(q)); }
    // Quick filter (chips)
    if (mail.quickFilter === 'unread') list = list.filter(e => !e.is_read);
    else if (mail.quickFilter === 'starred') list = list.filter(e => e.is_flagged);
    // Sort
    switch(mail.sort) {
      case 'date-desc': list.sort((a,b) => (b.date||'').localeCompare(a.date||'')); break;
      case 'date-asc':  list.sort((a,b) => (a.date||'').localeCompare(b.date||'')); break;
      case 'sender':    list.sort((a,b) => (a.sender||'').localeCompare(b.sender||'')); break;
      case 'unread':    list.sort((a,b) => (a.is_read?1:0)-(b.is_read?1:0)); break;
      case 'starred':   list.sort((a,b) => (b.is_flagged?1:0)-(a.is_flagged?1:0)); break;
      case 'ai-priority': list = mailAISort(list); break;
    }
    mail.filtered = list;
    mailRender();
  }

  // ─── Quick filter chips ───
  mail.quickFilter = 'all';
  window.mailSetFilter = function(f) {
    mail.quickFilter = f;
    document.querySelectorAll('.mail-chip').forEach(c => c.classList.toggle('active', c.dataset.filter === f));
    mailApplyFilters();
    if (f === 'ai') mailAIPrioritize();
  };

  // ─── Sort ───
  window.mailSetSort = function(s) {
    mail.sort = s;
    $('mail-sort-label').textContent = { 'date-desc':'Plus récent','date-asc':'Plus ancien','unread':'Non lus','starred':'Favoris','sender':'Expéditeur','ai-priority':'IA Priorité' }[s]||'Date';
    $('mail-sort-dropdown').classList.remove('show');
    document.querySelectorAll('.mail-sort-option').forEach(o => o.classList.toggle('active', o.dataset.sort === s));
    mailApplyFilters();
  };
  window.mailToggleSort = function() { $('mail-sort-dropdown').classList.toggle('show'); };
  document.addEventListener('click', e => { if (!e.target.closest('.mail-sort-wrap')) $('mail-sort-dropdown')?.classList.remove('show'); });

  // ─── AI Priority Sort ───
  function mailAISort(list) {
    // Score: unread=3, flagged=2, has attachment=1, recent=1
    return list.sort((a,b) => {
      let sa=0, sb=0;
      if (!a.is_read) sa+=3; if (!b.is_read) sb+=3;
      if (a.is_flagged) sa+=2; if (b.is_flagged) sb+=2;
      sa += (a.date||'').localeCompare(b.date||'') > 0 ? 1 : 0;
      sb += (b.date||'').localeCompare(a.date||'') > 0 ? 1 : 0;
      return sb - sa;
    });
  }

  // ─── AI Auto-reply preparation ───
  let aiReplyTimer = null;
  window.mailPrepareAIReply = async function(id) {
    if (aiReplyTimer) clearTimeout(aiReplyTimer);
    aiReplyTimer = setTimeout(async () => {
      try {
        const env = mail.all.find(e=>e.id===id);
        if (!env) return;
        const d = await api(`${MH}/message/${encodeURIComponent(id)}/html`);
        const text = (d.text||d.body||'').substring(0, 1500);
        const prompt = `Tu es l'assistant IA de Leo (Boubane). Rédige une réponse professionnelle concise en français à cet email. Juste le corps du mail, pas de signature.\\n\\nDe: ${env.sender||''}\\nObjet: ${env.subject||''}\\nContenu:\\n${text}\\n\\nRéponse:`;
        const r = await api('/api/hermes/chat',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:prompt}]})});
        const replyText = (r.choices?.[0]?.message?.content) || r.response || r.content || '';
        if (replyText) {
          // Store pre-generated reply
          mail.aiReplies = mail.aiReplies || {};
          mail.aiReplies[id] = replyText;
          // If reply panel is open for this mail, fill it
          const textarea = $('mail-reply-textarea');
          if (textarea && mailSelId === id && !textarea.value.trim()) {
            textarea.value = replyText;
            textarea.style.minHeight = '120px';
            textarea.focus();
          }
        }
      } catch(e) { console.warn('AI prep failed:', e); }
    }, 1500); // Wait 1.5s after opening mail
  };

  function initMailScroll() {
    const pane = $('mail-list-pane');
    if (pane) pane.addEventListener('scroll', mailScrollHandler, { passive: true });
  }

  function mailRender() {
    if (!mail.listEl) return;
    if (!mail.filtered.length) { mail.listEl.innerHTML = '<div class="mail-list-empty"><p>Aucun message</p></div>'; return; }
    mail.listEl.innerHTML = mail.filtered.map(e => {
      const sn = (e.sender||'').split('<')[0].trim()||e.sender|| '';
      const init = sn.charAt(0).toUpperCase()||'?';
      const col = avColor(sn);
      return `<div class="mail-row${e.is_read?'':' unread'}${e.id===mailSelId?' active':''}" data-id="${esc(e.id)}" onclick="mailOpen('${esc(e.id)}',this)">
        ${!e.is_read?'<div class="mail-row-unread-dot"></div>':''}
        <label class="mail-row-check" onclick="event.stopPropagation()">
          <input type="checkbox" ${mail.selected.has(e.id)?'checked':''} onchange="mailToggleSelect('${esc(e.id)}',this.checked)"><span class="mail-check-box"></span>
        </label>
        <button class="mail-star-btn${e.is_flagged?' starred':''}" onclick="event.stopPropagation();mailToggleStar('${esc(e.id)}',this)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="${e.is_flagged?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </button>
        <div class="mail-row-avatar" style="background:${col}">${init}</div>
        <div class="mail-row-body">
          <div class="mail-row-top"><div class="mail-row-from">${esc(sn)}</div><div class="mail-row-time">${fmtDate(e.date)}</div></div>
          <div class="mail-row-subject">${esc(e.subject)}</div>
          <div class="mail-row-preview" id="snip-${esc(e.id)}"></div>
        </div>
      </div>`;
    }).join('');
    mail.filtered.forEach(e => mailLoadSnippet(e.id));
  }

  // ─── Snippet loading (batched, with cache) ───
  const snippetQueue = [], snippetLoading = false;
  function mailLoadSnippet(id) {
    const el = $(`snip-${id}`); if (!el) return;
    if (snippetCache[id]) { el.textContent = snippetCache[id]; return; }
    snippetQueue.push(id);
    if (!snippetLoading) {
      snippetLoading = true;
      setTimeout(() => {
        const batch = snippetQueue.splice(0, 5);
        batch.forEach(mid => {
          api(`${MH}/message/${encodeURIComponent(mid)}/html`).then(d => {
            const t = (d.text||d.body||'').replace(/\s+/g,' ').trim().substring(0,120);
            snippetCache[mid] = t;
            const cel = $(`snip-${mid}`);
            if (cel) cel.textContent = t;
          }).catch(()=>{});
        });
        snippetLoading = false;
        if (snippetQueue.length) mailLoadSnippet(null);
      }, 100);
    }
  }

  window.mailToggleSelect = function(id, v) { if(v) mail.selected.add(id); else mail.selected.delete(id); mailUpdateBulk(); };
  window.mailSelectAll = function() {
    if (mail.selected.size === mail.all.length) mail.selected.clear(); else mail.all.forEach(e => mail.selected.add(e.id));
    mailRender(); mailUpdateBulk();
  };
  function mailUpdateBulk() {
    const sel = mail.selected.size;
    const label = `${sel} sélectionné${sel>1?'s':''}`;
    // Desktop
    const bd = $('mail-bulk-bar'); if (bd) bd.style.display = sel > 0 ? 'flex' : 'none';
    const cd = $('mail-bulk-count'); if (cd) cd.textContent = label;
    // Mobile
    const bm = $('mail-bulk-bar-mobile'); if (bm) bm.style.display = sel > 0 ? 'flex' : 'none';
    const cm = $('mail-bulk-count-mobile'); if (cm) cm.textContent = label;
  }

  window.mailToggleStar = async function(id, btn) {
    const e = mail.all.find(x => x.id===id); if (!e) return;
    try {
      await api(`${MH}/message/${id}/flag/${e.is_flagged?'remove':'add'}`, { method:'POST', body:JSON.stringify({flags:['Flagged']}) });
      e.is_flagged = !e.is_flagged;
      if (btn) { btn.classList.toggle('starred', e.is_flagged); btn.querySelector('svg')?.setAttribute('fill', e.is_flagged?'currentColor':'none'); }
    } catch(e2) { toast('Erreur: ' + e2.message, 'error'); }
  };

  window.mailMarkReadSelected = async function(read) {
    for (const id of mail.selected) { try { await api(`${MH}/message/${id}/flag/${read?'add':'remove'}`,{method:'POST',body:JSON.stringify({flags:['Seen']})}); } catch(e) {} }
    mail.selected.clear(); mailRefresh();
  };
  window.mailArchiveSelected = async function() {
    for (const id of mail.selected) { try { await api(`${MH}/message/${id}/move`,{method:'POST',body:JSON.stringify({folder:'[Gmail]/All Mail'})}); } catch(e) {} }
    mail.selected.clear(); toast('Archivés', 'success'); mailRefresh();
  };
  window.mailDeleteSelected = async function() {
    if (!confirm(`Supprimer ${mail.selected.size} message(s) ?`)) return;
    for (const id of mail.selected) { try { await api(`${MH}/message/${id}/delete`,{method:'POST'}); } catch(e) {} }
    mail.selected.clear(); toast('Supprimés', 'success'); mailRefresh();
  };

  // ─── Open mail detail ───
  window.mailOpen = async function(id, rowEl) {
    mailSelId = id;
    document.querySelectorAll('.mail-row').forEach(r => r.classList.remove('active'));
    if (rowEl) rowEl.classList.add('active');
    const env = mail.all.find(e => e.id===id);
    if (env && !env.is_read) {
      env.is_read = true;
      if (rowEl) rowEl.classList.remove('unread');
      api(`${MH}/message/${id}/flag/add`,{method:'POST',body:JSON.stringify({flags:['Seen']})}).catch(()=>{});
    }
    if (!mail.detailEl) mail.detailEl = $('mail-detail-pane');
    mail.detailEl.innerHTML = '<div class="mail-list-loading"><div class="spinner"></div></div>';
    if (window.innerWidth <= 1024) mail.detailEl.classList.add('mobile-show');

    // Start AI reply preparation in background
    mailPrepareAIReply(id);

    try {
      const d = await api(`${MH}/message/${encodeURIComponent(id)}/html`);
      const html = d.html, text = d.text||d.body||'(vide)';
      const envelope = mail.all.find(e=>e.id===id)||{};
      const from = d.from||envelope.sender||'';
      const sn = from.split('<')[0].trim()||from;
      const se = (from.match(/<(.+)>/)||[])[1]||'';
      const subj = d.subject||envelope.subject||'(sans objet)';
      const dt = d.date?fmtDate(d.date):(envelope.date?fmtDate(envelope.date):'');
      const init = sn.charAt(0).toUpperCase()||'?';
      const col = avColor(sn);
      const flag = envelope.is_flagged;
      const moves = mail.folders.filter(f=>f.name!==mail.folder).map(f =>
        `<button class="mail-action-dropdown-item" onclick="mailMoveFolder('${esc(f.name)}')">${esc(folderFr(f.name))}</button>`
      ).join('');
      const bodyContent = html ? `<div class="mail-html-body">${sanitize(html)}</div>` : `<div class="mail-text-body">${esc(text).replace(/\n/g,'<br>')}</div>`;

      mail.detailEl.innerHTML = `
        <!-- ═══ CONTENU SCROLLABLE ═══ -->
        <div class="mail-detail-body">
          <div class="mail-detail-header">
            <button class="mail-back-btn mail-back-btn-inline" onclick="mailGoBack()">${ICONS.back} Retour</button>
            <div class="mail-detail-subject">${esc(subj)}</div>
            <div class="mail-detail-from-row">
              <div class="mail-detail-avatar" style="background:${col}">${init}</div>
              <div class="mail-detail-sender-info">
                <div class="mail-detail-sender">${esc(sn)}</div>
                ${se?`<div class="mail-detail-email-addr">${esc(se)}</div>`:''}
              </div>
              <div class="mail-detail-date">${dt}</div>
            </div>
          </div>
          <div class="mail-detail-content">${bodyContent}</div>
        </div>

        <!-- ═══ BARRE D'ACTIONS MOBILE (fixe en bas) ═══ -->
        <div class="mail-detail-bottom-bar">
          <button class="mail-bottom-btn" onclick="mailToggleReply()">${ICONS.reply}<span>Répondre</span></button>
          <button class="mail-bottom-btn" onclick="mailFwd('${esc(id)}')">${ICONS.forward}<span>Transférer</span></button>
          <button class="mail-bottom-btn ai-btn-mobile" onclick="mailAIReply('${esc(id)}')">${ICONS.brain}<span>IA</span></button>
          <button class="mail-bottom-btn" onclick="mailArchiveOne('${esc(id)}')">${ICONS.archive}<span>Archiver</span></button>
          <button class="mail-bottom-btn mail-bottom-btn-danger" onclick="mailDeleteOne('${esc(id)}')">${ICONS.trash}<span>Supprimer</span></button>
          <div class="mail-bottom-dropdown-wrap">
            <button class="mail-bottom-btn" onclick="this.nextElementSibling.classList.toggle('show');event.stopPropagation()">${ICONS.more}<span>Plus</span></button>
            <div class="mail-action-dropdown mail-action-dropdown-up">
              <button class="mail-action-dropdown-item" onclick="mailMarkReadOne('${esc(id)}',false)">Marquer non lu</button>
              <button class="mail-action-dropdown-item" onclick="mailToggleStar('${esc(id)}',null)">${flag ? 'Retirer favori' : 'Favori'}</button>
              ${moves}
            </div>
          </div>
        </div>

        <!-- ═══ PANNEAU DE RÉPONSE (fermé par défaut) ═══ -->
        <div class="mail-reply-panel collapsed" id="mail-reply-panel">
          <div class="mail-reply-form">
            <div class="mail-reply-header">
              <span class="mail-reply-title">${ICONS.reply} Répondre à ${esc(sn)}</span>
              <button class="mail-reply-close" onclick="mailToggleReply()">${ICONS.close}</button>
            </div>
            <textarea class="mail-reply-textarea" id="mail-reply-textarea" placeholder="Écrire votre réponse… (Ctrl+Enter pour envoyer)"></textarea>
            <div class="mail-reply-actions">
              <div class="mail-reply-actions-left">
                <button class="mail-reply-btn mail-reply-btn-primary" onclick="mailSendReply('${esc(id)}')">${ICONS.send} Envoyer</button>
                <button class="mail-reply-btn mail-reply-btn-secondary" id="btn-ai-reply" onclick="mailAIReply('${esc(id)}')">${ICONS.brain} IA</button>
              </div>
            </div>
          </div>
        </div>`;
      mailLoadAttachments(id);
    } catch(e) {
      mail.detailEl.innerHTML = `<div style="padding:2rem;color:var(--red)">Erreur: ${esc(e.message)}</div>`;
    }
  };

  // ─── Reply panel ───
  window.mailToggleReply = function() {
    const panel = $('mail-reply-panel');
    if (!panel) return;
    const collapsed = panel.classList.contains('collapsed');
    panel.classList.toggle('collapsed', !collapsed);
    if (collapsed) setTimeout(() => $('mail-reply-textarea')?.focus(), 80);
  };

  // ─── Compose ───
  window.mailCompose = function() {
    const overlay = $('mail-compose-overlay');
    overlay.classList.add('open');
    overlay.classList.remove('mini');
    setTimeout(() => $('compose-to')?.focus(), 100);
  };
  window.mailComposeMini = function() {
    const overlay = $('mail-compose-overlay');
    overlay.classList.add('open', 'mini');
    setTimeout(() => $('compose-to')?.focus(), 100);
  };
  window.mailComposeClose = function() {
    $('mail-compose-overlay').classList.remove('open', 'mini');
    ['compose-to','compose-subject','compose-body'].forEach(id=>{const e=$(id);if(e)e.value='';});
  };

  window.mailSendReply = async function(id) {
    const body = $('mail-reply-textarea')?.value.trim();
    if (!body) { toast('Message vide', 'warning'); return; }
    const env = mail.all.find(x=>x.id===id)||{};
    const toMatch = (env.sender||'').match(/<(.+?)>/);
    const toAddr = toMatch?toMatch[1]:env.sender||'';
    const subject = (env.subject||'').startsWith('Re:') ? env.subject : `Re: ${env.subject||''}`;
    try {
      await api(`${MH}/send`,{method:'POST',body:JSON.stringify({to:toAddr,subject,body})});
      toast('✓ Message envoyé', 'success');
      $('mail-reply-textarea').value = '';
      mailToggleReply();
    } catch(e) { toast('Erreur: '+e.message, 'error'); }
  };

  // ─── AI Reply ───
  window.mailAIReply = async function(id) {
    const env = mail.all.find(x=>x.id===id)||{};
    // Animate all AI buttons (desktop toolbar + mobile bottom bar)
    const btns = [document.getElementById('btn-ai-reply'), ...document.querySelectorAll('.ai-btn-mobile')].filter(Boolean);
    btns.forEach(btn => {
      btn.classList.add('ai-loading');
      btn.dataset.origHtml = btn.innerHTML;
      btn.innerHTML = '<span class="ai-spinner"></span> IA…';
      btn.disabled = true;
    });
    try {
      let mailText = '';
      const d = await api(`${MH}/message/${encodeURIComponent(id)}/html`);
      mailText = d.text || d.body || '';
      const prompt = `Tu es l'assistant IA de Leo (Boubane). Rédige une réponse professionnelle en français à cet email. Sois concis, poli et utile. Juste le corps du mail.\n\nDe: ${env.sender||''}\nObjet: ${env.subject||''}\nContenu:\n${mailText.substring(0,2000)}\n\nRéponse:`;
      const r = await api('/api/hermes/chat',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:prompt}]})});
      const replyText = (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content)
        || r.response || r.content || r.message || '';
      if (!replyText) {
        console.warn('IA response:', JSON.stringify(r));
        btns.forEach(btn => { btn.classList.remove('ai-loading'); btn.innerHTML = btn.dataset.origHtml||'✨ IA'; btn.disabled = false; });
        return;
      }
      // Fill textarea and open reply panel
      const textarea = $('mail-reply-textarea');
      if (textarea) {
        textarea.value = replyText;
        textarea.style.minHeight = '180px';
        // Open reply panel if collapsed
        const panel = $('mail-reply-panel');
        if (panel && panel.classList.contains('collapsed')) panel.classList.remove('collapsed');
        textarea.focus();
      }
      btns.forEach(btn => { btn.classList.remove('ai-loading'); btn.innerHTML = btn.dataset.origHtml||'✨ IA'; btn.disabled = false; });
    } catch(e) {
      btns.forEach(btn => { btn.classList.remove('ai-loading'); btn.innerHTML = btn.dataset.origHtml||'✨ IA'; btn.disabled = false; });
    }
  };

  // ─── Actions ───
  window.mailArchiveOne = async function(id) {
    try { await api(`${MH}/message/${id}/move`,{method:'POST',body:JSON.stringify({folder:'[Gmail]/All Mail'})}); mailGoBack(); mailRefresh(); } catch(e) { toast('Erreur: '+e.message,'error'); }
  };
  window.mailDeleteOne = async function(id) {
    if (!confirm('Supprimer ?')) return;
    try { await api(`${MH}/message/${id}/delete`,{method:'POST'}); mailGoBack(); mailRefresh(); } catch(e) { toast('Erreur: '+e.message,'error'); }
  };
  window.mailMarkReadOne = async function(id, read) {
    try { await api(`${MH}/message/${id}/flag/${read?'add':'remove'}`,{method:'POST',body:JSON.stringify({flags:['Seen']})}); mailGoBack(); mailRefresh(); } catch(e) { toast('Erreur: '+e.message,'error'); }
  };
  window.mailMoveFolder = async function(folder) {
    try { await api(`${MH}/message/${mailSelId}/move`,{method:'POST',body:JSON.stringify({folder})}); toast('Déplacé','success'); mailGoBack(); mailRefresh(); } catch(e) { toast('Erreur: '+e.message,'error'); }
  };
  window.mailFwd = function(id) {
    const e = mail.all.find(x=>x.id===id)||{};
    mailCompose();
    $('compose-subject').value = (e.subject||'').startsWith('Fwd:')?e.subject:`Fwd: ${e.subject||''}`;
    $('compose-body').value = `\n\n---------- Transféré ----------\nDe: ${e.sender||''}\nObjet: ${e.subject||''}\n`;
    setTimeout(() => $('compose-to')?.focus(), 150);
  };
  window.mailGoBack = function() {
    if (mail.detailEl) {
      mail.detailEl.classList.remove('mobile-show');
      mail.detailEl.innerHTML = `<div class="mail-detail-empty"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M22 7l-10 7L2 7"/></svg><p>Sélectionnez un message</p><p class="hint">j/k pour naviguer · r pour répondre · e pour archiver</p></div>`;
    }
    mailSelId = null;
    document.querySelectorAll('.dash-email-row, .mail-row').forEach(r => r.classList.remove('active'));
  };
  window.mailFilter = function() {
    // Sync both search inputs
    const desktop = $('mail-search-input');
    const mobile = $('mail-search-input-mobile');
    // Use whichever has focus, or merge values
    const active = document.activeElement;
    if (active === desktop && mobile) mobile.value = desktop.value;
    else if (active === mobile && desktop) desktop.value = mobile.value;
    mail.search = (desktop?.value || mobile?.value || '').toLowerCase().trim();
    const bd = $('mail-search-clear'); if (bd) bd.style.display = mail.search?'flex':'none';
    const bm = $('mail-search-clear-mobile'); if (bm) bm.style.display = mail.search?'flex':'none';
    mailApplyFilters();
  };
  window.mailClearSearch = function() {
    const d = $('mail-search-input'); if(d) d.value='';
    const m = $('mail-search-input-mobile'); if(m) m.value='';
    const bd = $('mail-search-clear'); if(bd) bd.style.display='none';
    const bm = $('mail-search-clear-mobile'); if(bm) bm.style.display='none';
    mail.search=''; mailApplyFilters();
  };
  window.mailSwitchFolder = function() {
    // Sync both folder selects
    const dd = $('mail-folder-select');
    const dm = $('mail-folder-select-mobile');
    const active = document.activeElement;
    if (active === dd && dm) dm.value = dd.value;
    else if (active === dm && dd) dd.value = dm.value;
    mail.folder = (dd?.value || dm?.value || 'INBOX');
    mailSelId=null; mailRefresh();
  };
  window.mailComposeSend = async function() {
    const to=$('compose-to').value.trim(), subj=$('compose-subject').value.trim(), body=$('compose-body').value.trim();
    if (!to) { toast('Destinataire requis','warning'); return; }
    try { await api(`${MH}/send`,{method:'POST',body:JSON.stringify({to,subject:subj,body})}); toast('✓ Envoyé','success'); mailComposeClose(); } catch(e) { toast('Erreur: '+e.message,'error'); }
  };
  window.mailLoadFolders = mailLoadFolders;
  window.mailRefresh = mailRefresh;

  // ─── Attachments ───
  async function mailLoadAttachments(id) {
    const panel = $('mail-attachments-panel'), list = $('mail-attachments-list'), count = $('mail-attachments-count');
    if (!panel || !list) return;
    try {
      const d = await api(`${MH}/message/${id}/attachments`);
      const atts = d.attachments || [];
      if (!atts.length) { panel.style.display='none'; return; }
      panel.style.display='block';
      if (count) count.textContent = atts.length + ' pièce' + (atts.length>1?'s':'') + ' jointe' + (atts.length>1?'s':'');
      list.innerHTML = atts.map((att, i) => {
        const ext = (att.filename||'').split('.').pop()?.toLowerCase()||'';
        const icon = ['pdf','doc','docx','xls','xlsx','zip','rar'].includes(ext) ? '📄' : '📎';
        return `<div class="mail-attachment-chip" title="Télécharger ${esc(att.filename)}" onclick="toast('Téléchargement: ${esc(att.filename)}')"><span>${icon}</span><span>${esc(att.filename)}</span></div>`;
      }).join('');
    } catch(e) { panel.style.display='none'; }
  }

  /* ═══════════════════════════════════════════
     CHAT
     ═══════════════════════════════════════════ */
  window.chatSend = function(text) {
    const input = $('chat-input');
    const msg = text || input.value.trim();
    if (!msg) return;
    if (!text) input.value = '';
    input.style.height = 'auto';
    const c = $('chat-messages');
    const w = c.querySelector('.chat-welcome'); if (w) w.remove();
    chatAdd('user', msg);
    chatMsgs.push({ role:'user', content:msg });

    // Create streaming assistant bubble
    const load = document.createElement('div');
    load.className = 'chat-msg assistant'; load.id = 'chat-load';
    load.innerHTML = `<div class="chat-msg-avatar">B</div><div><div class="chat-msg-bubble" id="chat-stream-bubble"><span class="chat-cursor">▊</span></div></div>`;
    c.appendChild(load); c.scrollTop = c.scrollHeight;

    // Stream via fetch + ReadableStream (SSE)
    const bubble = $('chat-stream-bubble');
    let fullText = '';
    fetch('/api/hermes/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatMsgs.map(m=>({role:m.role,content:m.content})) }),
    }).then(resp => {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      function read() {
        reader.read().then(({done, value}) => {
          if (done) {
            const el = $('chat-load'); if (el) el.remove();
            if (fullText) chatMsgs.push({role:'assistant', content:fullText});
            return;
          }
          buf += decoder.decode(value, {stream: true});
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const d = line[6:].trim();
              if (d === '[DONE]') continue;
              try {
                const data = JSON.parse(d);
                if (data.delta) {
                  fullText += data.delta;
                  bubble.innerHTML = esc(fullText) + '<span class="chat-cursor">▊</span>';
                  c.scrollTop = c.scrollHeight;
                }
              } catch(err) {}
            }
          }
          read();
        }).catch(err => {
          const el = $('chat-load'); if (el) el.remove();
          if (!fullText) chatAdd('assistant', '⚠️ ' + err.message);
        });
      }
      read();
    }).catch(e => {
      const el = $('chat-load'); if (el) el.remove();
      chatAdd('assistant', '⚠️ ' + e.message);
    });
  };

  function chatAdd(role, text) {
    const c = $('chat-messages');
    const el = document.createElement('div');
    el.className = `chat-msg ${role}`;
    const t = new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    el.innerHTML = `<div class="chat-msg-avatar">${role==='user'?'L':'B'}</div><div><div class="chat-msg-bubble">${esc(text)}</div><div style="font-size:0.62rem;color:var(--text-muted);margin-top:2px">${t}</div></div>`;
    c.appendChild(el); c.scrollTop = c.scrollHeight;
  }

  window.chatKeyDown = function(e) { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); chatSend(); } };

  /* ═══════════════════════════════════════════
     AGENT STATUS
     ═══════════════════════════════════════════ */
  async function loadAgentStatus() {
    try {
      const s = await api('/api/agent/status');
      const el = $('agent-status');
      if (el) el.innerHTML = `<div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.4rem"><div style="width:8px;height:8px;border-radius:50%;background:var(--green)"></div><strong>${s.agent} v${s.version}</strong></div><p style="font-size:0.8rem;color:var(--text-muted)">${s.status}</p>`;
    } catch(e) {}
  }

  /* ═══════════════════════════════════════════
     BUSINESS
     ═══════════════════════════════════════════ */
  async function loadBusinessOverview() {
    try {
      const d = await api('/api/business/overview');
      if ($('biz-clients')) $('biz-clients').textContent = d.clients?.total ?? 0;
      if ($('biz-trial')) $('biz-trial').textContent = `${d.clients?.trial ?? 0} essai${(d.clients?.trial||0)!==1?'s':''}`;
      if ($('biz-mrr')) $('biz-mrr').textContent = `€${d.revenue?.mrr ?? 0}`;
      if ($('biz-arr')) $('biz-arr').textContent = `€${d.revenue?.arr ?? 0} / an`;
      const siteStatus = d.site?.status || 'unknown';
      const siteColors = { up:'var(--green)', down:'var(--red)', degraded:'var(--yellow)', unknown:'var(--text-muted)' };
      if ($('biz-site-status')) { $('biz-site-status').textContent = siteStatus.toUpperCase(); $('biz-site-status').style.color = siteColors[siteStatus]||siteColors.unknown; }
      if ($('biz-site-uptime')) $('biz-site-uptime').textContent = d.site?.uptime_pct ? `${d.site.uptime_pct}% uptime` : '— uptime';
      const plans = d.clients?.by_plan || {};
      const planLabels = { starter:'Starter', pro:'Pro', enterprise:'Enterprise' };
      const planColors = { starter:'#7a9e7e', pro:'#3b82f6', enterprise:'#a855f7' };
      const total = Object.values(plans).reduce((a,b)=>a+b,0)||1;
      if ($('biz-plans')) $('biz-plans').innerHTML = Object.entries(plans).map(([p,c]) =>
        `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem"><div style="width:8px;height:8px;border-radius:50%;background:${planColors[p]||'var(--text-muted)'}"></div><span style="font-size:0.78rem;color:var(--text-secondary);flex:1">${planLabels[p]||p}</span><span style="font-size:0.78rem;font-weight:600">${c}</span><div style="width:60px;height:3px;background:var(--bg-surface-2);border-radius:2px;overflow:hidden"><div style="width:${(c/total)*100}%;height:100%;background:${planColors[p]||'var(--text-muted)'}"></div></div></div>`
      ).join('') || '<p style="color:var(--text-muted);font-size:0.78rem">Aucun client</p>';
      loadRecentClients();
    } catch(e) {}
  }

  async function loadRecentClients() {
    try {
      const d = await api('/api/business/clients?limit=5');
      const c = $('biz-recent-clients');
      if (!d.clients?.length) { if(c) c.innerHTML='<p style="color:var(--text-muted);font-size:0.78rem">Aucun client</p>'; return; }
      c.innerHTML = d.clients.map(cl => {
        const init = (cl.name||'?').charAt(0).toUpperCase();
        const col = avColor(cl.name||'?');
        const sc = { active:'var(--green)', trial:'var(--yellow)', churned:'var(--red)', paused:'var(--text-muted)' };
        return `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0;border-bottom:1px solid var(--border)">
          <div style="width:26px;height:26px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;color:#fff;flex-shrink:0">${init}</div>
          <div style="flex:1;min-width:0"><div style="font-size:0.75rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(cl.name)}</div>
          <div style="font-size:0.65rem;color:var(--text-muted)">${esc(cl.company||cl.email||'')}</div></div>
          <div style="width:5px;height:5px;border-radius:50%;background:${sc[cl.status]||'var(--text-muted)'}"></div>
        </div>`;
      }).join('');
    } catch(e) {}
  }

  async function loadClients(filter) {
    clientFilterStatus = filter || 'all';
    try {
      const params = new URLSearchParams();
      if (clientFilterStatus !== 'all') params.set('status', clientFilterStatus);
      const d = await api(`/api/business/clients?${params}`);
      const c = $('clients-list');
      if (!d.clients?.length) { if(c) c.innerHTML='<div class="empty-state"><p>Aucun client</p></div>'; return; }
      c.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:0.75rem">` +
        d.clients.map(cl => {
          const init = (cl.name||'?').charAt(0).toUpperCase();
          const col = avColor(cl.name||'?');
          const sc = { active:'var(--green)', trial:'var(--yellow)', churned:'var(--red)', paused:'var(--text-muted)' };
          const pc = { starter:'#7a9e7e', pro:'#3b82f6', enterprise:'#a855f7' };
          return `<div style="background:var(--bg-surface-2);border:1px solid var(--border);border-radius:var(--r-md);padding:0.75rem">
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">
              <div style="width:30px;height:30px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;color:#fff;flex-shrink:0">${init}</div>
              <div style="flex:1;min-width:0"><div style="font-size:0.8rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(cl.name)}</div>
              <div style="font-size:0.68rem;color:var(--text-muted)">${esc(cl.email||'')}</div></div>
            </div>
            ${cl.company ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:0.4rem">${esc(cl.company)}</div>` : ''}
            <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap">
              <span style="font-size:0.62rem;padding:0.1rem 0.4rem;border-radius:4px;background:${pc[cl.plan]||'var(--bg-surface)'}20;color:${pc[cl.plan]||'var(--text-muted)'};font-weight:600">${cl.plan}</span>
              <span style="font-size:0.62rem;padding:0.1rem 0.4rem;border-radius:4px;background:${sc[cl.status]||'var(--bg-surface)'}20;color:${sc[cl.status]||'var(--text-muted)'}">${cl.status}</span>
              ${cl.mrr ? `<span style="font-size:0.7rem;font-weight:600;margin-left:auto">€${cl.mrr}/mo</span>` : ''}
            </div></div>`;
        }).join('') + '</div>';
    } catch(e) { if($('clients-list')) $('clients-list').innerHTML=`<p style="color:var(--red);font-size:0.78rem">Erreur: ${esc(e.message)}</p>`; }
  }

  function clientFilter(filter, btn) {
    document.querySelectorAll('.biz-filter').forEach(b=>{b.classList.remove('active','btn-secondary');b.classList.add('btn-ghost');});
    btn.classList.add('active','btn-secondary'); btn.classList.remove('btn-ghost');
    loadClients(filter);
  }

  async function clientSave() {
    const data = {
      name:$('client-name').value.trim(), email:$('client-email').value.trim(),
      company:$('client-company').value.trim(), plan:$('client-plan').value,
      status:$('client-status').value, mrr:parseFloat($('client-mrr').value)||0,
      notes:$('client-notes').value.trim(),
    };
    if (!data.name) { toast('Nom requis','warning'); return; }
    try {
      await api('/api/business/clients',{method:'POST',body:JSON.stringify(data)});
      toast('✓ Client ajouté','success');
      $('client-modal').classList.remove('open');
      loadClients(clientFilterStatus); loadBusinessOverview();
    } catch(e) { toast('Erreur: '+e.message,'error'); }
  }

  async function loadSiteStatus() {
    try {
      const d = await api('/api/business/site/status');
      const dot = $('cms-status-dot'), txt = $('cms-status-text');
      if (dot) dot.style.background = d.status === 'up' ? 'var(--green)' : 'var(--red)';
      if (txt) txt.textContent = d.status === 'up' ? 'En ligne' : 'Hors ligne';
    } catch(e) {}
  }

  async function siteCheck() {
    toast('Vérification…','info');
    try {
      const d = await api('/api/business/site/check',{method:'POST'});
      toast(d.status==='up'?'✓ Site en ligne':'✗ '+d.status, d.status==='up'?'success':'error');
      loadSiteStatus();
    } catch(e) { toast('Erreur: '+e.message,'error'); }
  }

  /* ═══════════════════════════════════════════
     CALENDAR
     ═══════════════════════════════════════════ */
  async function loadCalendar() {
    try {
      const d = await api('/api/calendar/overview');
      if ($('cal-today-count')) $('cal-today-count').textContent = d.stats?.today ?? 0;
      if ($('cal-week-count')) $('cal-week-count').textContent = d.stats?.upcoming_7days ?? 0;
      if ($('cal-accounts-count')) $('cal-accounts-count').textContent = d.stats?.connected_accounts ?? 0;
      renderCalEvents(d.upcoming || []);
      const now = new Date();
      const ws = new Date(now); ws.setDate(now.getDate()-now.getDay()+(calWeekOffset*7));
      const we = new Date(ws); we.setDate(ws.getDate()+6);
      const label = `${ws.toLocaleDateString('fr-FR',{day:'numeric',month:'short'})} → ${we.toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}`;
      if ($('cal-week-label')) $('cal-week-label').textContent = label;
    } catch(e) {}
  }

  function renderCalEvents(events) {
    const c = $('cal-events-list'); if (!c) return;
    if (!events.length) { c.innerHTML='<div class="empty-state"><p>Aucun événement</p></div>'; return; }
    c.innerHTML = events.map(ev => {
      const start = ev.start_time ? new Date(ev.start_time) : null;
      const dayStr = start ? start.toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'}) : '';
      const timeStr = start ? start.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : '';
      const pc = { google:'#4285f4', caldav:'#0078d4', outlook:'#0078d4', local:'var(--accent)' };
      return `<div style="display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid var(--border)">
        <div style="width:3px;height:28px;border-radius:2px;background:${pc[ev.provider]||pc.local};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:0.8rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ev.title)}</div>
          ${ev.location ? `<div style="font-size:0.68rem;color:var(--text-muted)">📍 ${esc(ev.location)}</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0"><div style="font-size:0.72rem;font-weight:500">${dayStr}</div><div style="font-size:0.65rem;color:var(--text-muted)">${timeStr}</div></div>
      </div>`;
    }).join('');
  }

  function calOpenModal() {
    $('cal-modal-title').textContent = 'Nouveau rendez-vous';
    ['cal-title','cal-start','cal-end','cal-location','cal-desc'].forEach(id=>{const e=$(id);if(e)e.value='';});
    $('cal-modal').classList.add('open');
  }
  function calCloseModal() { $('cal-modal').classList.remove('open'); }
  async function calSave() {
    const title=$('cal-title').value.trim(), start=$('cal-start').value, end=$('cal-end').value;
    const location=$('cal-location').value.trim(), desc=$('cal-desc').value.trim();
    if (!title) { toast('Titre requis','warning'); return; }
    if (!start) { toast('Date de début requise','warning'); return; }
    try {
      await api('/api/calendar/events',{method:'POST',body:JSON.stringify({title,start_time:new Date(start).toISOString(),end_time:end?new Date(end).toISOString():'',location,description:desc})});
      toast('✓ Événement créé','success'); calCloseModal(); loadCalendar();
    } catch(e) { toast('Erreur: '+e.message,'error'); }
  }
  function calShowAccounts() { $('cal-accounts-modal').classList.add('open'); }
  function calCloseAccountsModal() { $('cal-accounts-modal').classList.remove('open'); }
  function calPrevWeek() { calWeekOffset--; loadCalendar(); }
  function calNextWeek() { calWeekOffset++; loadCalendar(); }

  /* ═══════════════════════════════════════════
     AUTO REPLY
     ═══════════════════════════════════════════ */
  async function loadAutoConfig() {
    try {
      const d = await api(`${MH}/auto/config`);
      autoConfigCache = d;
      const t = (id, val) => { const el = $(id); if (el) el.checked = !!val; };
      t('auto-enabled', d.enabled); t('auto-sort', d.auto_sort); t('auto-reply-draft', d.auto_reply_draft);
      const poll = $('auto-poll-interval'); if (poll) poll.value = d.poll_interval_min || 5;
      const rulesC = $('auto-rules-list');
      if (rulesC) {
        if (!d.sort_rules?.length) { rulesC.innerHTML = '<p style="color:var(--text-muted);font-size:0.72rem">Aucune règle</p>'; }
        else { rulesC.innerHTML = d.sort_rules.map((r,i) => `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0.5rem;background:var(--bg-surface-2);border-radius:6px;margin-bottom:0.25rem"><span style="font-size:0.68rem;font-weight:600;color:var(--accent);min-width:70px">${esc(r.category)}</span><span style="font-size:0.62rem;color:var(--text-muted);flex:1;text-align:right">→ ${esc(r.folder)}</span><button class="btn btn-sm btn-ghost" onclick="deleteAutoRule(${i})" style="padding:0.1rem 0.3rem;color:var(--red)">✕</button></div>`).join(''); }
      }
    } catch(e) {}
  }

  async function saveAutoConfig() {
    const cfg = {
      enabled:$('auto-enabled')?.checked??true, auto_sort:$('auto-sort')?.checked??true,
      auto_reply_draft:$('auto-reply-draft')?.checked??true,
      poll_interval_min:parseInt($('auto-poll-interval')?.value)||5,
      reply_ignore_senders:autoConfigCache?.reply_ignore_senders||['noreply','no-reply','notification','mailer-daemon'],
      sort_ignore_categories:autoConfigCache?.sort_ignore_categories||[],
      sort_rules:autoConfigCache?.sort_rules||[],
    };
    try { await api(`${MH}/auto/config`,{method:'POST',body:JSON.stringify(cfg)}); toast('✓ Configuration sauvegardée','success'); loadAutoConfig(); } catch(e) { toast('Erreur: '+e.message,'error'); }
  }

  async function triggerAutoProcess() {
    toast('⏳ Traitement…','info');
    try {
      const d = await api(`${MH}/auto/process`,{method:'POST'});
      const p = []; if(d.processed) p.push(`${d.processed} traité(s)`); if(d.sorted) p.push(`${d.sorted} trié(s)`); if(d.replied) p.push(`${d.replied} brouillon(s)`);
      toast(`✓ ${p.join(' — ')||'Rien à traiter'}`, 'success');
      loadAutoLog();
    } catch(e) { toast('Erreur: '+e.message,'error'); }
  }

  async function loadAutoLog() {
    try {
      const d = await api(`${MH}/auto/log?limit=50`);
      const c = $('auto-log-list'); if (!c) return;
      const entries = d.log || [];
      if (!entries.length) { c.innerHTML='<div class="empty-state"><p>Aucune action</p></div>'; return; }
      const labels = { sort:'📁 Tri', classify:'🏷️ Classification', draft_reply:'✉️ Brouillon', reply_skip:'⏭️ Ignoré', sort_error:'❌ Erreur tri', reply_error:'❌ Erreur réponse' };
      c.innerHTML = entries.map(e => {
        const ts = e.ts ? new Date(e.ts).toLocaleString('fr-FR') : '';
        return `<div style="display:flex;align-items:flex-start;gap:0.5rem;padding:0.35rem 0;border-bottom:1px solid var(--border)">
          <span style="font-size:0.62rem;color:var(--text-muted);min-width:100px;padding-top:1px">${ts}</span>
          <span style="font-size:0.7rem;font-weight:500;min-width:120px">${labels[e.action]||e.action}</span>
          <span style="font-size:0.65rem;color:var(--text-secondary);flex:1">${esc(e.detail||e.category||'')}</span>
        </div>`;
      }).join('');
    } catch(e) { if($('auto-log-list')) $('auto-log-list').innerHTML=`<p style="color:var(--red);font-size:0.72rem">Erreur: ${e.message}</p>`; }
  }

  /* ═══════════════════════════════════════════
     GLOBAL EXPORTS
     ═══════════════════════════════════════════ */
  window.go = go;
  window.toggleSidebar = toggleSidebar;
  window.loadStats = loadStats;
  window.loadActivity = loadActivity;
  window.loadFiles = loadFiles;
  window.browseWeb = browseWeb;
  window.mailOpen = mailOpen;
  window.mailToggleSelect = mailToggleSelect;
  window.mailSelectAll = mailSelectAll;
  window.mailToggleStar = mailToggleStar;
  window.mailMarkReadSelected = mailMarkReadSelected;
  window.mailArchiveSelected = mailArchiveSelected;
  window.mailDeleteSelected = mailDeleteSelected;
  window.mailArchiveOne = mailArchiveOne;
  window.mailDeleteOne = mailDeleteOne;
  window.mailMoveFolder = mailMoveFolder;
  window.mailFwd = mailFwd;
  window.mailGoBack = mailGoBack;
  window.mailFilter = mailFilter;
  window.mailClearSearch = mailClearSearch;
  window.mailSwitchFolder = mailSwitchFolder;
  window.mailCompose = mailCompose;
  window.mailComposeClose = mailComposeClose;
  window.mailComposeSend = mailComposeSend;
  window.mailLoadFolders = mailLoadFolders;
  window.mailRefresh = mailRefresh;
  window.mailToggleReply = mailToggleReply;
  window.mailSendReply = mailSendReply;
  window.mailAIReply = mailAIReply;
  window.chatSend = chatSend;
  window.chatKeyDown = chatKeyDown;
  window.loadBusinessOverview = loadBusinessOverview;
  window.loadClients = loadClients;
  window.clientFilter = clientFilter;
  window.clientOpenModal = function(id) { const m=$('client-modal'); if(m)m.classList.add('open'); };
  window.clientCloseModal = function() { const m=$('client-modal'); if(m)m.classList.remove('open'); };
  window.clientSave = clientSave;
  window.loadSiteStatus = loadSiteStatus;
  window.siteCheck = siteCheck;
  window.loadCalendar = loadCalendar;
  window.calOpenModal = calOpenModal;
  window.calCloseModal = calCloseModal;
  window.calSave = calSave;
  window.calPrevWeek = calPrevWeek;
  window.calNextWeek = calNextWeek;
  window.calShowAccounts = calShowAccounts;
  window.calCloseAccountsModal = calCloseAccountsModal;
  window.loadAutoConfig = loadAutoConfig;
  window.saveAutoConfig = saveAutoConfig;
  window.addAutoRule = async function() {
    const cat = prompt('Catégorie:'); if (!cat) return;
    const folder = prompt('Dossier cible:','INBOX'); if (!folder) return;
    if (!autoConfigCache) autoConfigCache = await api(`${MH}/auto/config`);
    if (!autoConfigCache.sort_rules) autoConfigCache.sort_rules = [];
    autoConfigCache.sort_rules.push({ category:cat, folder, senders:[], keywords:[] });
    await saveAutoConfig();
  };
  window.deleteAutoRule = async function(i) {
    if (!autoConfigCache?.sort_rules) return;
    autoConfigCache.sort_rules.splice(i, 1);
    await saveAutoConfig();
  };
  window.triggerAutoProcess = triggerAutoProcess;
  window.loadAutoLog = loadAutoLog;
  window.fileViewerOpen = async function(id) {
    const f = await api(`/api/files/${id}`);
    const container = $('file-list-container');
    const viewer = $('file-viewer');
    if (!container || !viewer) return;
    container.style.display = 'none';
    viewer.style.display = 'block';
    $('file-viewer-name').textContent = f.filename || '';
    $('file-viewer-type').textContent = (f.type||'').toUpperCase();
    $('file-viewer-size').textContent = fmtSize(f.size);
    const body = $('file-viewer-body');
    const ext = (f.type||'').toLowerCase();
    if (['png','jpg','jpeg','webp','gif','svg','bmp'].includes(ext)) {
      body.innerHTML = `<img src="/api/files/${f.id}/download" alt="${esc(f.filename)}" style="max-width:100%;height:auto;border-radius:8px">`;
    } else if (ext === 'pdf') {
      body.innerHTML = `<div style="text-align:center;padding:2rem"><p style="font-weight:600;margin-bottom:0.5rem">Document PDF</p><a href="/api/files/${f.id}/download" class="btn btn-primary btn-sm" download>Télécharger</a></div>`;
    } else {
      body.innerHTML = `<pre>${esc(f.extracted_text||f.summary||'Pas de contenu extrait.')}</pre>`;
    }
  };
  window.fileViewerClose = function() {
    $('file-viewer').style.display = 'none';
    $('file-list-container').style.display = 'block';
  };
  window.fileSetFilter = function(filter) {
    document.querySelectorAll('.file-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
    // Re-render with filter
    const files = window._fileCache || [];
    const filtered = filter === 'all' ? files : files.filter(f => {
      const t = (f.file_type||'').toLowerCase();
      if (filter === 'image') return ['png','jpg','jpeg','webp','gif','svg','bmp'].includes(t);
      if (filter === 'txt') return ['txt','md','csv','json','xml','html','css','js','py','sh'].includes(t);
      return t === filter;
    });
    renderFiles('file-list', filtered);
  };
  window.fileFilter = function() {
    const q = ($('file-search-input')?.value||'').toLowerCase();
    const files = window._fileCache || [];
    const filtered = q ? files.filter(f => (f.original_name||'').toLowerCase().includes(q) || (f.tags||'').toLowerCase().includes(q)) : files;
    renderFiles('file-list', filtered);
  };

  // ─── Create task from email ───
  window.mailCreateTask = async function(mailId, subject) {
    const env = mail.all.find(e=>e.id===mailId)||{};
    const title = `📧 ${subject}`;
    const desc = `De: ${env.sender||''}\nMail: ${mailId}`;
    try {
      await api('/api/kanban/card', {method:'POST', body: JSON.stringify({title, description:desc, mail_id:mailId, sender:env.sender||'', subject, column:'À faire'})});
      // Show toast near the toolbar
      const toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;padding:0.5rem 1rem;border-radius:100px;font-size:0.75rem;font-weight:600;z-index:100;animation:fadeInOut 2.5s ease forwards;';
      toast.textContent = '✓ Tâche créée';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2500);
    } catch(e) { console.error('Task creation failed:', e); }
  };

  // ─── Kanban ───
  window.loadKanban = async function() {
    const container = $('kanban-board');
    if (!container) return;
    const {columns, cards} = await api('/api/kanban/');
    // Render columns
    container.innerHTML = columns.map(col => `
      <div class="kanban-col" data-col="${esc(col)}">
        <div class="kanban-col-header">
          <span class="kanban-col-title">${esc(col)}</span>
          <span class="kanban-col-count">${cards.filter(c=>c.column===col).length}</span>
        </div>
        <div class="kanban-col-body" data-col="${esc(col)}">
          ${cards.filter(c=>c.column===col).map(card => `
            <div class="kanban-card" draggable="true" data-id="${card.id}" ondragstart="kanbanDragStart(event)">
              <div class="kanban-card-title">${esc(card.title)}</div>
              ${card.sender ? `<div class="kanban-card-from">De: ${esc(card.sender)}</div>` : ''}
              <div class="kanban-card-actions">
                <button class="kanban-card-btn" onclick="kanbanDeleteCard('${card.id}')">${ICONS.trash}</button>
              </div>
            </div>`).join('')}
        </div>
        <button class="kanban-add-btn" onclick="kanbanAddCard('${esc(col)}')">+ Ajouter</button>
      </div>`).join('');
    // Drop zones
    document.querySelectorAll('.kanban-col-body').forEach(el => {
      el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
      el.addEventListener('drop', e => {
        e.preventDefault(); el.classList.remove('drag-over');
        const cardId = e.dataTransfer.getData('text/plain');
        const col = el.dataset.col;
        api('/api/kanban/move', {method:'POST', body:JSON.stringify({card_id:cardId, column:col})}).then(() => loadKanban());
      });
    });
  };
  window.kanbanDragStart = function(e) { e.dataTransfer.setData('text/plain', e.currentTarget.dataset.id); };
  window.kanbanDeleteCard = async function(id) {
    await api(`/api/kanban/card/${id}`, {method:'DELETE'});
    loadKanban();
  };
  window.kanbanAddCard = async function(col) {
    const title = prompt('Titre de la tâche:');
    if (!title) return;
    await api('/api/kanban/card', {method:'POST', body:JSON.stringify({title, column:col})});
    loadKanban();
  };

})();
