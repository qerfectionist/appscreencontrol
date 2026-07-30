let currentChild = 'brother';
let devicesData = {};

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

  // Battery Indicator
  const batVal = dev.battery || 100;
  const batChip = document.getElementById('battery-chip');
  batChip.textContent = `🔋 ${batVal}%`;
  if (batVal < 20) {
    batChip.style.background = 'rgba(255, 69, 58, 0.15)';
    batChip.style.color = '#ff453a';
    batChip.style.borderColor = 'rgba(255, 69, 58, 0.3)';
  } else {
    batChip.style.background = 'rgba(48, 209, 88, 0.15)';
    batChip.style.color = '#30d158';
    batChip.style.borderColor = 'rgba(48, 209, 88, 0.3)';
  }

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
    lockMsg.textContent = '🟢 Статус: Доступ разрешен';
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

  // Timeline Feed
  renderFeed(dev.logs || []);
}

function updateTabSubtitles() {
  const b = devicesData['brother'];
  const s = devicesData['sister'];
  if (b) document.getElementById('status-brother').textContent = `${b.isOnline ? 'В сети 🟢' : 'Офлайн ⚪'} • ${b.currentApp || 'Нет'}`;
  if (s) document.getElementById('status-sister').textContent = `${s.isOnline ? 'В сети 🟢' : 'Офлайн ⚪'} • ${s.currentApp || 'Нет'}`;
}

function renderCategoryAnalytics(apps, totalSecs) {
  const container = document.getElementById('analytics-categories-list');
  if (!apps || apps.length === 0) {
    container.innerHTML = '<div style="color: var(--text-secondary); font-size: 13px; text-align: center; padding: 10px;">Статистика по категориям собирается...</div>';
    return;
  }

  const categoryTotals = {};
  for (const app of apps) {
    const cat = app.category || 'Other';
    categoryTotals[cat] = (categoryTotals[cat] || 0) + (app.seconds || 0);
  }

  const categoryLabels = {
    'Media': { label: '🎬 Медиа и Видео (YouTube/TikTok)', color: '#bf5af2' },
    'Social': { label: '💬 Соцсети (Instagram/Telegram)', color: '#ff2d55' },
    'Browsing': { label: '🌐 Поиск в интернете (Chrome)', color: '#64d2ff' },
    'Games': { label: '🎮 Игры (Free Fire/Brawl Stars)', color: '#ff9f0a' },
    'Education': { label: '🎓 Обучение (Duolingo)', color: '#30d158' },
    'Other': { label: '📱 Системные и Прочее', color: '#8e8e93' }
  };

  container.innerHTML = Object.keys(categoryTotals).map(catKey => {
    const secs = categoryTotals[catKey];
    const catMeta = categoryLabels[catKey] || { label: catKey, color: '#8e8e93' };
    const pct = totalSecs > 0 ? Math.round((secs / totalSecs) * 100) : 0;

    return `
      <div style="margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; font-size: 12px; color: #ffffff; margin-bottom: 4px; font-weight: 600;">
          <span>${catMeta.label}</span>
          <span style="font-weight: 700; color: rgba(255,255,255,0.9);">${formatSeconds(secs)} (${pct}%)</span>
        </div>
        <div style="height: 7px; background: rgba(120,120,128,0.24); border-radius: 9999px; overflow: hidden;">
          <div style="height: 100%; width: ${pct}%; background: ${catMeta.color}; border-radius: 9999px; transition: width 0.4s ease;"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderFeed(logs) {
  const container = document.getElementById('parent-timeline-feed');
  if (logs.length === 0) {
    container.innerHTML = '<div style="color: var(--text-secondary); text-align: center; padding: 12px; font-size: 13px;">Активность не зафиксирована</div>';
    return;
  }

  container.innerHTML = logs.slice(0, 15).map(log => {
    let icon = '📱';
    if (log.isAlert || log.type === 'alert') icon = '🚨';
    else if (log.type === 'video') icon = '📺';
    else if (log.type === 'search') icon = '🔍';
    else if (log.type === 'social') icon = '💬';

    const alertStyle = log.isAlert || log.type === 'alert' ? 'border-left: 3px solid #ff453a; background: rgba(255, 69, 58, 0.12); padding: 10px 14px; border-radius: 12px; margin-bottom: 6px;' : '';

    return `
      <div class="feed-item" style="${alertStyle}">
        <div class="feed-icon">${icon}</div>
        <div>
          <div class="feed-title" style="${log.isAlert || log.type === 'alert' ? 'color: #ff453a; font-weight: 700;' : ''}">${escapeHtml(log.app)}: ${escapeHtml(log.content)}</div>
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

// Event Handlers

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

// Auto-refresh every 3s
loadData();
setInterval(loadData, 3000);
