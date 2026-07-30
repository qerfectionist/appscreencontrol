let currentChild = 'brother';
let devicesData = {};
let currentKeywords = [];

const APPS_LIST = [
  { name: 'YouTube', icon: '▶️' },
  { name: 'TikTok', icon: '🎵' },
  { name: 'Free Fire', icon: '🎮' },
  { name: 'Instagram', icon: '📸' },
  { name: 'Chrome', icon: '🌐' }
];

function formatSeconds(secs) {
  if (!secs || secs === 0) return '0 мин';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h} ч ${m} мин`;
  return `${m} мин`;
}

function formatTimeAgo(isoString) {
  if (!isoString) return 'Неизвестно';
  const diffSecs = Math.floor((new Date() - new Date(isoString)) / 1000);
  if (diffSecs < 10) return 'Только что';
  if (diffSecs < 60) return `${diffSecs} сек назад`;
  const mins = Math.floor(diffSecs / 60);
  if (mins < 60) return `${mins} мин назад`;
  return `${Math.floor(mins / 60)} ч назад`;
}

async function loadData() {
  try {
    const res = await fetch('/api/dashboard/stats');
    if (!res.ok) throw new Error('API error');
    devicesData = await res.json();
    renderUI();
  } catch (err) {
    console.error('Failed to load parent app data:', err);
  }
}

function renderUI() {
  updateTabSubtitles();
  const dev = devicesData[currentChild];
  if (!dev) return;

  currentKeywords = dev.keywords || [];

  // Battery
  document.getElementById('battery-chip').textContent = `🔋 ${dev.battery || 100}%`;

  // Instant Lock Toggle
  const limits = dev.limits || { maxDailyTimeSeconds: 0, isLocked: false, appLimits: {} };
  const lockToggle = document.getElementById('toggle-instant-lock');
  lockToggle.checked = !!limits.isLocked;

  const lockMsg = document.getElementById('lock-status-msg');
  if (limits.isLocked) {
    lockMsg.className = 'lock-banner-msg active-lock';
    lockMsg.textContent = '🔒 Статус: ТЕЛЕФОН ЗАБЛОКИРОВАН';
  } else {
    lockMsg.className = 'lock-banner-msg';
    lockMsg.textContent = '🟢 Статус: Телефон разблокирован';
  }

  // Daily Limit & Time Used
  const totalSecs = dev.totalScreenTimeSeconds || 0;
  const maxLimitSecs = (limits.maxDailyTimeSeconds !== undefined && limits.maxDailyTimeSeconds !== null) ? limits.maxDailyTimeSeconds : 0;

  document.getElementById('used-time-val').textContent = formatSeconds(totalSecs);
  document.getElementById('daily-limit-badge').textContent = maxLimitSecs > 0 ? `${formatSeconds(maxLimitSecs)} / день` : 'Без лимита';
  document.getElementById('used-time-sub').textContent = maxLimitSecs > 0 ? `использовано из ${formatSeconds(maxLimitSecs)}` : 'время за сегодня';

  const pct = maxLimitSecs > 0 ? Math.min(100, Math.round((totalSecs / maxLimitSecs) * 100)) : 100;
  document.getElementById('daily-progress-fill').style.width = pct + '%';

  // Preset Buttons Active State
  document.querySelectorAll('.preset-btn').forEach(btn => {
    const sec = parseInt(btn.getAttribute('data-seconds'));
    if (sec === maxLimitSecs) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Category Analytics Breakdown
  renderCategoryAnalytics(dev.apps || [], totalSecs);

  // App Specific Timers List
  renderAppTimers(limits.appLimits || {});

  // Keyword Chips
  renderKeywordChips(currentKeywords);

  // Timeline Feed
  renderFeed(dev.logs || []);
}

function updateTabSubtitles() {
  const b = devicesData['brother'];
  const s = devicesData['sister'];
  if (b) document.getElementById('status-brother').textContent = `${b.isOnline ? 'В сети' : 'Офлайн'} • ${b.currentApp || 'Нет'}`;
  if (s) document.getElementById('status-sister').textContent = `${s.isOnline ? 'В сети' : 'Офлайн'} • ${s.currentApp || 'Нет'}`;
}

function renderCategoryAnalytics(apps, totalSecs) {
  const container = document.getElementById('analytics-categories-list');
  if (!apps || apps.length === 0) {
    container.innerHTML = '<div style="color: #94a3b8; font-size: 13px;">Статистика по категориям накапливается...</div>';
    return;
  }

  const categoryTotals = {};
  for (const app of apps) {
    const cat = app.category || 'Other';
    categoryTotals[cat] = (categoryTotals[cat] || 0) + (app.seconds || 0);
  }

  const categoryLabels = {
    'Media': { label: '🎬 Медиа и Видео (YouTube/TikTok)', color: '#8b5cf6' },
    'Social': { label: '💬 Соцсети (Instagram/Telegram)', color: '#ec4899' },
    'Browsing': { label: '🌐 Поиск в интернете (Chrome)', color: '#06b6d4' },
    'Games': { label: '🎮 Игры (Free Fire/Brawl Stars)', color: '#f59e0b' },
    'Education': { label: '🎓 Обучение (Duolingo)', color: '#10b981' },
    'Other': { label: '📱 Системные и Прочее', color: '#64748b' }
  };

  container.innerHTML = Object.keys(categoryTotals).map(catKey => {
    const secs = categoryTotals[catKey];
    const catMeta = categoryLabels[catKey] || { label: catKey, color: '#64748b' };
    const pct = totalSecs > 0 ? Math.round((secs / totalSecs) * 100) : 0;

    return `
      <div style="margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; font-size: 12px; color: #cbd5e1; margin-bottom: 4px;">
          <span>${catMeta.label}</span>
          <span style="font-weight: 700; color: #fff;">${formatSeconds(secs)} (${pct}%)</span>
        </div>
        <div style="height: 6px; background: #334155; border-radius: 4px; overflow: hidden;">
          <div style="height: 100%; width: ${pct}%; background: ${catMeta.color}; border-radius: 4px; transition: width 0.3s ease;"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderAppTimers(appLimits) {
  const container = document.getElementById('app-timers-list');
  container.innerHTML = APPS_LIST.map(app => {
    const limitSecs = appLimits[app.name] || 0;
    return `
      <div class="timer-item">
        <div class="timer-app-name">
          <span>${app.icon}</span>
          <span>${app.name}</span>
        </div>
        <select class="timer-select" data-app="${app.name}">
          <option value="0" ${limitSecs === 0 ? 'selected' : ''}>Без лимита</option>
          <option value="1800" ${limitSecs === 1800 ? 'selected' : ''}>30 мин</option>
          <option value="3600" ${limitSecs === 3600 ? 'selected' : ''}>1 час</option>
          <option value="5400" ${limitSecs === 5400 ? 'selected' : ''}>1.5 часа</option>
          <option value="7200" ${limitSecs === 7200 ? 'selected' : ''}>2 часа</option>
        </select>
      </div>
    `;
  }).join('');
}

function renderKeywordChips(keywords) {
  const container = document.getElementById('keywords-chips-container');
  if (!keywords || keywords.length === 0) {
    container.innerHTML = '<span style="color: #94a3b8; font-size: 12px;">Нет добавленных ключевых слов</span>';
    return;
  }

  container.innerHTML = keywords.map(kw => `
    <span style="background: #7f1d1d; color: #fca5a5; padding: 4px 10px; border-radius: 20px; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; font-weight: 600;">
      ⚠️ ${escapeHtml(kw)}
      <button onclick="removeKeyword('${escapeHtml(kw)}')" style="background: none; border: none; color: #fca5a5; font-size: 14px; cursor: pointer; padding: 0;">&times;</button>
    </span>
  `).join('');
}

async function removeKeyword(kw) {
  try {
    await fetch('/api/parent/keywords', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: kw })
    });
    loadData();
  } catch (e) {
    console.error('Delete keyword error:', e);
  }
}

function renderFeed(logs) {
  const container = document.getElementById('parent-timeline-feed');
  if (logs.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 10px;">Активность еще не зафиксирована</div>';
    return;
  }

  container.innerHTML = logs.slice(0, 15).map(log => {
    let icon = '📱';
    if (log.isAlert || log.type === 'alert') icon = '🚨';
    else if (log.type === 'video') icon = '📺';
    else if (log.type === 'search') icon = '🔍';
    else if (log.type === 'social') icon = '💬';

    const alertStyle = log.isAlert || log.type === 'alert' ? 'border-left: 3px solid #ef4444; background: #450a0a; padding: 8px 12px; border-radius: 8px; margin-bottom: 6px;' : '';

    return `
      <div class="feed-item" style="${alertStyle}">
        <div class="feed-icon">${icon}</div>
        <div>
          <div class="feed-title" style="${log.isAlert || log.type === 'alert' ? 'color: #fca5a5; font-weight: bold;' : ''}">${escapeHtml(log.app)}: ${escapeHtml(log.content)}</div>
          <div class="feed-time">${formatTimeAgo(log.timestamp)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}

// Actions & Event Handlers

// Child Tab Switcher
document.querySelectorAll('.child-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.child-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentChild = tab.getAttribute('data-child');
    renderUI();
  });
});

// Instant Lock Toggle
document.getElementById('toggle-instant-lock').addEventListener('change', async (e) => {
  const isLocked = e.target.checked;
  try {
    await fetch('/api/parent/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: currentChild, isLocked: isLocked })
    });
    loadData();
  } catch (err) {
    console.error('Lock toggle error:', err);
  }
});

// Preset Buttons (Daily Limit)
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const seconds = parseInt(btn.getAttribute('data-seconds'));
    try {
      await fetch('/api/parent/limits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: currentChild, maxDailyTimeSeconds: seconds })
      });
      loadData();
    } catch (err) {
      console.error('Limit set error:', err);
    }
  });
});

// Add Forbidden Keyword
document.getElementById('btn-add-keyword').addEventListener('click', async () => {
  const input = document.getElementById('input-new-keyword');
  const kw = input.value.trim();
  if (!kw) return;

  try {
    await fetch('/api/parent/keywords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: kw })
    });
    input.value = '';
    loadData();
  } catch (err) {
    console.error('Add keyword error:', err);
  }
});

// Save App-Specific Timers
document.getElementById('btn-save-limits').addEventListener('click', async () => {
  const appLimits = {};
  document.querySelectorAll('.timer-select').forEach(sel => {
    const app = sel.getAttribute('data-app');
    const val = parseInt(sel.value);
    appLimits[app] = val;
  });

  try {
    await fetch('/api/parent/limits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: currentChild, appLimits: appLimits })
    });
    alert('✅ Таймеры успешно сохранены!');
    loadData();
  } catch (err) {
    console.error('Save limits error:', err);
  }
});

// Auto-refresh every 3s for live OTA updates
loadData();
setInterval(loadData, 3000);
