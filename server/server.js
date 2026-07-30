const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const os = require('os');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

// Path to compiled APK file for Over-The-Air auto-updates
const APK_PATH = path.join(__dirname, '../android/app/build/outputs/apk/debug/app-debug.apk');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve APK download for automatic in-app updates
app.get('/download/app-debug.apk', (req, res) => {
  if (fs.existsSync(APK_PATH)) {
    res.download(APK_PATH, 'app-debug.apk');
  } else {
    res.status(404).json({ error: 'APK file not found' });
  }
});

// Version check endpoint for auto-updater
app.get('/api/app/version', (req, res) => {
  res.json({
    versionCode: 4,
    versionName: "1.3",
    apkUrl: "/download/app-debug.apk"
  });
});

function mapPackageToName(pkg) {
  if (!pkg) return 'Приложение';
  const lower = pkg.toLowerCase();
  if (lower.includes('instagram')) return 'Instagram';
  if (lower.includes('youtube')) return 'YouTube';
  if (lower.includes('tiktok') || lower.includes('trill')) return 'TikTok';
  if (lower.includes('chrome')) return 'Chrome';
  if (lower.includes('freefire')) return 'Free Fire';
  if (lower.includes('brawl')) return 'Brawl Stars';
  if (lower.includes('telegram')) return 'Telegram';
  if (lower.includes('duolingo')) return 'Duolingo';
  return pkg.split('.').pop() || pkg;
}

// REST APIs

// Device Heartbeat / Registration
app.post('/api/heartbeat', async (req, res) => {
  const { deviceId, name, model, battery, currentApp } = req.body;
  if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });

  try {
    const appLabel = mapPackageToName(currentApp);
    await db.updateHeartbeat(deviceId, name, model, battery, appLabel);
    const allStats = await db.getAllDevicesStats();
    res.json({
      success: true,
      device: allStats[deviceId],
      config: allStats[deviceId]?.limits,
      version: { versionCode: 4, apkUrl: "/download/app-debug.apk" }
    });
  } catch (err) {
    console.error('Heartbeat DB error:', err);
    res.status(500).json({ error: err.message });
  }
});

// App Usage Sync
app.post('/api/track/usage', async (req, res) => {
  const { deviceId, apps, totalScreenTimeSeconds } = req.body;
  if (!deviceId || !Array.isArray(apps)) {
    return res.status(400).json({ error: 'deviceId and apps array are required' });
  }

  try {
    const formattedApps = apps.map(a => ({
      ...a,
      label: mapPackageToName(a.packageName || a.label)
    }));
    await db.updateAppUsage(deviceId, formattedApps, totalScreenTimeSeconds);
    const allStats = await db.getAllDevicesStats();
    res.json({ success: true, limits: allStats[deviceId]?.limits });
  } catch (err) {
    console.error('Usage sync DB error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Screen Content & Realtime Activity Log
app.post('/api/track/content', async (req, res) => {
  const { deviceId, app, content, type } = req.body;
  if (!deviceId || !content) {
    return res.status(400).json({ error: 'deviceId and content are required' });
  }

  try {
    const appLabel = mapPackageToName(app);
    await db.addContentLog(deviceId, appLabel, content, type);
    const allStats = await db.getAllDevicesStats();
    res.json({ success: true, limits: allStats[deviceId]?.limits });
  } catch (err) {
    console.error('Content sync DB error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Dashboard Analytics Data
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const stats = await db.getAllDevicesStats();
    res.json(stats);
  } catch (err) {
    console.error('Dashboard stats DB error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Parent API: Update Timers & Limits
app.post('/api/parent/limits', async (req, res) => {
  const { deviceId, maxDailyTimeSeconds, appLimits } = req.body;
  if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });

  try {
    await db.updateDeviceLimits(deviceId, maxDailyTimeSeconds, appLimits);
    const stats = await db.getAllDevicesStats();
    res.json({ success: true, limits: stats[deviceId]?.limits });
  } catch (err) {
    console.error('Update limits DB error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Parent API: Toggle Instant Lock
app.post('/api/parent/lock', async (req, res) => {
  const { deviceId, isLocked } = req.body;
  if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });

  try {
    await db.setDeviceLockStatus(deviceId, isLocked);
    res.json({ success: true, isLocked: !!isLocked });
  } catch (err) {
    console.error('Lock status DB error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Forbidden Keywords API
app.get('/api/parent/keywords', async (req, res) => {
  try {
    const keywords = await db.getForbiddenKeywords();
    res.json(keywords);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/parent/keywords', async (req, res) => {
  const { keyword } = req.body;
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });
  try {
    await db.addForbiddenKeyword(keyword);
    const keywords = await db.getForbiddenKeywords();
    res.json({ success: true, keywords });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/parent/keywords', async (req, res) => {
  const { keyword } = req.body;
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });
  try {
    await db.deleteForbiddenKeyword(keyword);
    const keywords = await db.getForbiddenKeywords();
    res.json({ success: true, keywords });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Child API: Get Config & Lock State
app.get('/api/child/config', async (req, res) => {
  const { deviceId } = req.query;
  if (!deviceId) return res.status(400).json({ error: 'deviceId query param is required' });

  try {
    const stats = await db.getAllDevicesStats();
    const dev = stats[deviceId];
    if (!dev) return res.status(404).json({ error: 'Device not found' });

    res.json({
      deviceId: dev.id,
      limits: dev.limits,
      totalScreenTimeSeconds: dev.totalScreenTimeSeconds || 0,
      apps: dev.apps || [],
      latestVersionCode: 4
    });
  } catch (err) {
    console.error('Child config DB error:', err);
    res.status(500).json({ error: err.message });
  }
});

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

// Initialize Database & Start Express Server
db.initDb().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    const ips = getLocalIpAddresses();
    console.log(`====================================================`);
    console.log(` AppScreenControl SQL Server Running (PORT ${PORT}):`);
    console.log(` - Local (ПК):           http://localhost:${PORT}`);
    console.log(` - Parent Mobile App:    http://localhost:${PORT}/parent`);
    console.log(` - APK Download URL:     http://localhost:${PORT}/download/app-debug.apk`);
    ips.forEach(ip => {
      console.log(` - Mobile Parent PWA:    http://${ip}:${PORT}/parent`);
    });
    console.log(`====================================================`);
  });
}).catch(err => {
  console.error("FATAL: Failed to initialize SQL database:", err);
});
