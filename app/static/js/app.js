/**
 * BOUBANE DASHBOARD — Frontend Application
 */
(function() {
  'use strict';

  // ─── State ───
  let currentPage = 'dashboard';
  let currentEmailId = null;

  // ─── Init ───
  document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initUpload();
    loadStats();
    loadActivity();
    
    // Refresh stats every 30s
    setInterval(loadStats, 30000);
  });

  // ─── Navigation ───
  function initNavigation() {
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.addEventListener('click', () => {
        const page = item.dataset.page;
        switchPage(page);
      });
    });
  }

  function switchPage(page) {
    currentPage = page;
    
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });
    
    // Update sections
    document.querySelectorAll('.page-section').forEach(section => {
      section.classList.toggle('active', section.id === `page-${page}`);
    });
    
    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
    
    // Page-specific loading
    if (page === 'files') loadFiles();
    if (page === 'web') loadWebHistory();
    if (page === 'emails') loadEmails();
    if (page === 'activity') loadActivity();
    if (page === 'settings') loadAgentStatus();
  }

  function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
  }

  // ─── API Helper ───
  async function api(url, options = {}) {
    try {
      const resp = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }
      return await resp.json();
    } catch (e) {
      console.error('API error:', e);
      throw e;
    }
  }

  // ─── Toast ───
  function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = message;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 400);
    }, 3500);
  }

  // ─── Stats ───
  async function loadStats() {
    try {
      const stats = await api('/api/agent/stats');
      setText('stat-files', stats.files?.total || 0);
      setText('stat-web', stats.web?.total || 0);
      setText('stat-emails', stats.emails?.total || 0);
      setText('stat-unread', stats.emails?.unread || 0);
      
      // Update badges
      const fileBadge = document.getElementById('file-count');
      if (fileBadge) fileBadge.textContent = stats.files?.total || 0;
      
      const emailBadge = document.getElementById('email-count');
      if (emailBadge) emailBadge.textContent = stats.emails?.unread || 0;
      
      // Update activity on dashboard
      if (stats.recent_activity?.length > 0) {
        renderActivity('dashboard-activity', stats.recent_activity);
      }
    } catch (e) {
      console.warn('Stats load failed:', e);
    }
  }

  // ─── Files ───
  function initUpload() {
    const zone = document.getElementById('upload-zone');
    const input = document.getElementById('file-input');
    
    if (!zone || !input) return;
    
    input.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFiles(e.target.files);
      }
    });
    
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('drag-over');
    });
    
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    });
  }

  async function handleFiles(files) {
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      
      try {
        const result = await fetch('/api/files/upload', {
          method: 'POST',
          body: formData,
        });
        
        if (!result.ok) {
          const err = await result.json().catch(() => ({}));
          throw new Error(err.detail || `Upload failed`);
        }
        
        const data = await result.json();
        toast(`✓ "${data.filename}" analysé (${formatSize(data.size)})`, 'success');
      } catch (e) {
        toast(`✗ Erreur: ${e.message}`, 'error');
      }
    }
    
    loadFiles();
    loadStats();
  }

  async function loadFiles() {
    try {
      const data = await api('/api/files/list?limit=20');
      renderFileList('file-list', data.files);
      
      if (data.files.length > 0) {
        renderFileList('dashboard-files', data.files.slice(0, 5));
      }
    } catch (e) {
      console.warn('Files load failed:', e);
    }
  }

  function renderFileList(containerId, files) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (!files || files.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>Aucun fichier</p></div>';
      return;
    }
    
    container.innerHTML = files.map(f => `
      <div class="file-item" onclick="viewFile(${f.id})">
        <div class="file-icon ${f.type}">${f.type}</div>
        <div class="file-info">
          <div class="file-name">${escapeHtml(f.filename)}</div>
          <div class="file-meta">${formatSize(f.size)} · ${f.tags?.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ') || ''}</div>
        </div>
      </div>
    `).join('');
  }

  async function viewFile(id) {
    try {
      const file = await api(`/api/files/${id}`);
      const modal = document.getElementById('email-modal');
      document.getElementById('modal-email-subject').textContent = file.filename;
      document.getElementById('modal-email-from').textContent = `${file.type} · ${formatSize(file.size)}`;
      document.getElementById('modal-email-date').textContent = file.created_at ? new Date(file.created_at).toLocaleString('fr-FR') : '';
      document.getElementById('modal-email-body').textContent = file.summary + (file.text ? '\n\n---\n\n' + file.text.substring(0, 2000) : '');
      document.getElementById('modal-email-ai').style.display = 'none';
      modal.classList.add('open');
    } catch (e) {
      toast('Erreur: ' + e.message, 'error');
    }
  }

  // ─── Web ───
  async function browseWeb() {
    const url = document.getElementById('web-url').value.trim();
    const taskType = document.getElementById('web-task-type').value;
    
    if (!url) {
      toast('Entrez une URL', 'error');
      return;
    }
    
    const resultEl = document.getElementById('web-result');
    resultEl.innerHTML = '<div class="loading-spinner" style="margin:2rem auto;"></div>';
    
    try {
      const data = await api('/api/web/browse', {
        method: 'POST',
        body: JSON.stringify({ url, task_type: taskType }),
      });
      
      if (data.status === 'done') {
        resultEl.textContent = data.result || 'Aucun contenu extrait';
        toast('✓ Page visitée avec succès', 'success');
      } else {
        resultEl.textContent = `Erreur: ${data.error || 'Inconnue'}`;
        toast('Erreur lors de la visite', 'error');
      }
      
      loadWebHistory();
      loadStats();
    } catch (e) {
      resultEl.textContent = `Erreur: ${e.message}`;
      toast('Erreur: ' + e.message, 'error');
    }
  }

  async function loadWebHistory() {
    try {
      const data = await api('/api/web/tasks?limit=10');
      const container = document.getElementById('web-history');
      if (!container) return;
      
      if (!data.tasks || data.tasks.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Aucune page visitée</p></div>';
        return;
      }
      
      container.innerHTML = data.tasks.map(t => `
        <div class="activity-item">
          <div class="activity-dot ${t.status === 'done' ? 'green' : 'orange'}"></div>
          <div>
            <div class="activity-text"><strong>${escapeHtml(t.type)}</strong> — ${escapeHtml(t.url.substring(0, 60))}</div>
            <div class="activity-time">${t.status} · ${t.created_at ? new Date(t.created_at).toLocaleString('fr-FR') : ''}</div>
          </div>
        </div>
      `).join('');
    } catch (e) {
      console.warn('Web history load failed:', e);
    }
  }

  // ─── Emails ───
  async function loadEmails() {
    try {
      const data = await api('/api/email/list?limit=30');
      renderEmailList(data.emails);
    } catch (e) {
      console.warn('Emails load failed:', e);
    }
  }

  function renderEmailList(emails) {
    const container = document.getElementById('email-list');
    if (!container) return;
    
    if (!emails || emails.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M22 7l-10 7L2 7"/></svg>
          </div>
          <h3>Aucun email</h3>
          <p>Configurez votre boîte mail puis récupérez vos emails</p>
        </div>`;
      return;
    }
    
    container.innerHTML = emails.map(e => `
      <div class="email-item ${e.is_read ? '' : 'unread'}" onclick="openEmail(${e.id})">
        <div>
          <div class="email-from">${escapeHtml(e.sender || 'Inconnu')}</div>
          <div class="email-subject">${escapeHtml(e.subject || '(sans objet)')}</div>
        </div>
        <div class="email-time">${e.received_at ? formatDate(e.received_at) : ''}</div>
      </div>
    `).join('');
  }

  async function fetchEmails() {
    toast('Récupération en cours...', 'info');
    try {
      const data = await api('/api/email/fetch', { method: 'POST', body: JSON.stringify({ limit: 50 }) });
      toast(`✓ ${data.fetched} emails récupérés (${data.new} nouveaux)`, 'success');
      loadEmails();
      loadStats();
    } catch (e) {
      toast('Erreur: ' + e.message, 'error');
    }
  }

  async function openEmail(id) {
    currentEmailId = id;
    try {
      const email = await api(`/api/email/${id}`);
      const modal = document.getElementById('email-modal');
      document.getElementById('modal-email-subject').textContent = email.subject || '(sans objet)';
      document.getElementById('modal-email-from').textContent = email.sender || 'Inconnu';
      document.getElementById('modal-email-date').textContent = email.received_at ? new Date(email.received_at).toLocaleString('fr-FR') : '';
      document.getElementById('modal-email-body').textContent = email.body || '(pas de contenu)';
      
      const aiBlock = document.getElementById('modal-email-ai');
      const aiText = document.getElementById('modal-email-ai-text');
      if (email.ai_response) {
        aiBlock.style.display = 'block';
        aiText.textContent = email.ai_response;
      } else {
        aiBlock.style.display = 'none';
      }
      
      modal.classList.add('open');
      loadEmails();
      loadStats();
    } catch (e) {
      toast('Erreur: ' + e.message, 'error');
    }
  }

  function closeEmailModal() {
    document.getElementById('email-modal').classList.remove('open');
    currentEmailId = null;
  }

  async function generateAiResponse() {
    if (!currentEmailId) return;
    try {
      const data = await api(`/api/email/${currentEmailId}/ai-response`, { method: 'POST' });
      const aiBlock = document.getElementById('modal-email-ai');
      const aiText = document.getElementById('modal-email-ai-text');
      aiBlock.style.display = 'block';
      aiText.textContent = data.response;
      toast('✓ Réponse suggérée', 'success');
    } catch (e) {
      toast('Erreur: ' + e.message, 'error');
    }
  }

  function showEmailConfig() {
    switchPage('settings');
  }

  async function saveEmailConfig() {
    const config = {
      imap_host: document.getElementById('cfg-imap-host').value.trim(),
      imap_user: document.getElementById('cfg-imap-user').value.trim(),
      imap_pass: document.getElementById('cfg-imap-pass').value.trim(),
      smtp_host: document.getElementById('cfg-smtp-host').value.trim(),
      imap_port: 993,
      smtp_port: 587,
    };
    
    if (!config.imap_host || !config.imap_user) {
      toast('IMAP host et utilisateur requis', 'error');
      return;
    }
    
    try {
      await api('/api/email/config', {
        method: 'POST',
        body: JSON.stringify(config),
      });
      toast('✓ Configuration sauvegardée', 'success');
    } catch (e) {
      toast('Erreur: ' + e.message, 'error');
    }
  }

  // ─── Activity ───
  async function loadActivity() {
    try {
      const data = await api('/api/agent/activity?limit=30');
      renderActivity('full-activity-log', data.activity);
    } catch (e) {
      console.warn('Activity load failed:', e);
    }
  }

  function renderActivity(containerId, items) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (!items || items.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>Aucune activité</p></div>';
      return;
    }
    
    container.innerHTML = items.map(item => {
      let dotColor = 'clay';
      if (item.status === 'success') dotColor = 'green';
      else if (item.status === 'error') dotColor = 'orange';
      
      return `
        <div class="activity-item">
          <div class="activity-dot ${dotColor}"></div>
          <div>
            <div class="activity-text"><strong>${escapeHtml(item.action)}</strong> — ${escapeHtml(item.details || '')}</div>
            <div class="activity-time">${item.status} · ${item.time ? new Date(item.time).toLocaleString('fr-FR') : ''}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ─── Agent Status ───
  async function loadAgentStatus() {
    try {
      const status = await api('/api/agent/status');
      const el = document.getElementById('agent-status');
      if (el) {
        el.innerHTML = `
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
            <div style="width:10px;height:10px;border-radius:50%;background:var(--sage);"></div>
            <strong>Agent ${status.agent} v${status.version}</strong>
          </div>
          <p style="font-size:0.85rem;color:var(--text-muted);">Status: ${status.status}</p>
          <p style="font-size:0.85rem;color:var(--text-muted);margin-top:0.5rem;">
            Capacités: ${status.capabilities?.join(', ')}
          </p>
        `;
      }
    } catch (e) {
      console.warn('Agent status load failed:', e);
    }
  }

  // ─── Utilities ───
  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatSize(bytes) {
    if (!bytes) return '0 o';
    if (bytes < 1024) return bytes + ' o';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ko';
    return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    
    if (diff < 60000) return "À l'instant";
    if (diff < 3600000) return `Il y a ${Math.floor(diff / 60000)}min`;
    if (diff < 86400000) return `Il y a ${Math.floor(diff / 3600000)}h`;
    if (diff < 172800000) return 'Hier';
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }

  // ─── Expose to global scope for onclick handlers ───
  window.switchPage = switchPage;
  window.toggleSidebar = toggleSidebar;
  window.browseWeb = browseWeb;
  window.fetchEmails = fetchEmails;
  window.openEmail = openEmail;
  window.closeEmailModal = closeEmailModal;
  window.generateAiResponse = generateAiResponse;
  window.showEmailConfig = showEmailConfig;
  window.saveEmailConfig = saveEmailConfig;
  window.viewFile = viewFile;

})();
