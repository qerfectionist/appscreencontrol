let currentDevice = 'brother';
let devicesData = {};
let chartInstance = null;

// App category icons mapping
const APP_ICONS = {
  'YouTube': '▶️',
  'YouTube Shorts': '🎬',
  'TikTok': '🎵',
  'Free Fire': '🎮',
  'Chrome': '🌐',
  'Instagram': '📸',
  'Duolingo': '🦉',
  'Telegram': '✈️',
  'Brawl Stars': '⭐',
  'Roblox': '🧱'
};

function getAppIcon(name) {
  for (let key in APP_ICONS) {
    if (name.toLowerCase().includes(key.toLowerCase())) {
      return APP_ICONS[key];
    }
  }
  return '📱';
}

function formatSeconds(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h} ч ${m} мин`;
  return `${m} мин`;
}

function formatTimeAgo(isoString) {
  if (!isoString) return 'Неизвестно';
  const diffSecs = Math.floor((new Date() - new Date(isoString)) / 1000);
  if (diffSecs < 10) return 'Меньше 10 сек назад';
  if (diffSecs < 60) return `${diffSecs} сек назад`;
  const mins = Math.floor(diffSecs / 60);
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  return `${hours} ч назад`;
}

async function fetchStats() {
  try {
    const res = await fetch('/api/dashboard/stats');
    if (!res.ok) throw new Error('API error');
    devicesData = await res.json();
    
    document.getElementById('sync-status').textContent = 'В сети (Синхронизировано)';
    updateUI();
  } catch (err) {
    console.error('Fetch stats failed:', err);
    document.getElementById('sync-status').textContent = 'Ошибка подключения к серверу';
  }
}

function updateUI() {
  updateTabSubtitles();
  const dev = devicesData[currentDevice];
  if (!dev) return;

  // 1. Metric Cards
  const totalSecs = dev.totalScreenTimeSeconds || 0;
  document.getElementById('metric-screen-time').textContent = formatSeconds(totalSecs);
  const limitPct = Math.min(100, Math.round((totalSecs / 14400) * 100)); // limit 4 hours
  document.getElementById('bar-screen-time').style.width = limitPct + '%';

  document.getElementById('metric-current-app').textContent = dev.currentApp || 'Вне приложения';
  
  const onlineDot = document.getElementById('metric-online-dot');
  const onlineText = document.getElementById('metric-online-text');
  if (dev.isOnline) {
    onlineDot.className = 'status-dot online';
    onlineText.textContent = 'В сети';
  } else {
    onlineDot.className = 'status-dot offline';
    onlineText.textContent = 'Офлайн';
  }
  document.getElementById('metric-last-seen').textContent = formatTimeAgo(dev.lastSeen);

  document.getElementById('metric-battery').textContent = `${dev.battery || 100}%`;
  document.getElementById('bar-battery').style.width = `${dev.battery || 100}%`;
  document.getElementById('metric-device-model').textContent = dev.model || 'Android Device';

  // Top App
  if (dev.apps && dev.apps.length > 0) {
    const sortedApps = [...dev.apps].sort((a, b) => b.seconds - a.seconds);
    const topApp = sortedApps[0];
    document.getElementById('metric-top-app').textContent = topApp.label;
    document.getElementById('metric-top-app-time').textContent = `${formatSeconds(topApp.seconds)} сегодня`;
  } else {
    document.getElementById('metric-top-app').textContent = 'Нет данных';
    document.getElementById('metric-top-app-time').textContent = '0 мин';
  }

  // 2. Apps List
  renderAppsList(dev.apps || [], totalSecs);

  // 3. Chart
  renderChart(dev.apps || []);

  // 4. Timeline
  renderTimeline(dev.logs || []);
}

function updateTabSubtitles() {
  const b = devicesData['brother'];
  const s = devicesData['sister'];
  if (b) {
    document.getElementById('tab-status-brother').textContent = `${b.isOnline ? 'В сети' : 'Офлайн'} • ${b.currentApp || 'Нет'}`;
  }
  if (s) {
    document.getElementById('tab-status-sister').textContent = `${s.isOnline ? 'В сети' : 'Офлайн'} • ${s.currentApp || 'Нет'}`;
  }
}

function renderAppsList(apps, totalSecs) {
  const container = document.getElementById('apps-list-container');
  const badge = document.getElementById('apps-count-badge');
  badge.textContent = `${apps.length} прилож.`;

  if (apps.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px;">Нет зафиксированных приложений</div>';
    return;
  }

  const sorted = [...apps].sort((a, b) => b.seconds - a.seconds);
  container.innerHTML = sorted.map(app => {
    const icon = getAppIcon(app.label);
    const pct = totalSecs > 0 ? Math.round((app.seconds / totalSecs) * 100) : 0;
    return `
      <div class="app-item">
        <div class="app-icon-box">${icon}</div>
        <div class="app-info">
          <div class="app-name-row">
            <span>${app.label}</span>
            <span class="app-time">${formatSeconds(app.seconds)} (${pct}%)</span>
          </div>
          <div class="progress-bar-container" style="height: 6px; margin-bottom: 0;">
            <div class="progress-bar" style="width: ${pct}%;"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderChart(apps) {
  const ctx = document.getElementById('usageChart').getContext('2d');
  const labels = apps.map(a => a.label);
  const data = apps.map(a => Math.round(a.seconds / 60)); // mins

  if (chartInstance) {
    chartInstance.destroy();
  }

  const colors = [
    '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#a855f7'
  ];

  chartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors.slice(0, labels.length),
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#f1f5f9',
            font: { family: 'Plus Jakarta Sans', size: 12 }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return ` ${context.label}: ${context.raw} мин`;
            }
          }
        }
      },
      cutout: '70%'
    }
  });
}

function renderTimeline(logs) {
  const container = document.getElementById('timeline-container');
  const searchQuery = document.getElementById('feed-search').value.toLowerCase();
  const filterType = document.getElementById('feed-filter').value;

  const filtered = logs.filter(log => {
    const matchesSearch = log.content.toLowerCase().includes(searchQuery) || log.app.toLowerCase().includes(searchQuery);
    const matchesFilter = filterType === 'all' || log.type === filterType;
    return matchesSearch && matchesFilter;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px;">Записи не найдены</div>';
    return;
  }

  container.innerHTML = filtered.map(log => {
    let icon = '📱';
    if (log.type === 'video') icon = '📺';
    if (log.type === 'search') icon = '🔍';
    if (log.type === 'education') icon = '🎓';

    return `
      <div class="timeline-item">
        <div class="timeline-icon">${icon}</div>
        <div class="timeline-content">
          <span class="timeline-app-badge">${log.app}</span>
          <div class="timeline-text">${escapeHtml(log.content)}</div>
        </div>
        <div class="timeline-time">${formatTimeAgo(log.timestamp)}</div>
      </div>
    `;
  }).join('');
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}

async function simulateActivity(app, content, type) {
  try {
    await fetch('/api/track/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: currentDevice,
        app: app,
        content: content,
        type: type
      })
    });
    fetchStats();
  } catch (e) {
    console.error('Simulation failed:', e);
  }
}

// Event Listeners
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentDevice = btn.getAttribute('data-device');
    updateUI();
  });
});

document.getElementById('btn-seed').addEventListener('click', async () => {
  await fetch('/api/demo/seed', { method: 'POST' });
  fetchStats();
});

document.getElementById('feed-search').addEventListener('input', updateUI);
document.getElementById('feed-filter').addEventListener('change', updateUI);

// Initial Load & Auto-poll
fetchStats();
setInterval(fetchStats, 3000);
