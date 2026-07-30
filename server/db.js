const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const DATABASE_URL = process.env.DATABASE_URL;

let isPg = false;
let isJsonFallback = false;
let pgPool = null;
let sqliteDb = null;
let memoryStore = {
  devices: {},
  device_limits: {},
  content_logs: [],
  app_usage: [],
  forbidden_keywords: ['казино', 'ставка', 'порно', 'наркотики', 'суицид', 'взлом']
};

const JSON_DB_PATH = path.join(__dirname, 'data_fallback.json');

function saveJsonFallback() {
  try {
    fs.writeFileSync(JSON_DB_PATH, JSON.stringify(memoryStore, null, 2));
  } catch (e) {
    console.error('Failed to save JSON fallback DB:', e);
  }
}

function loadJsonFallback() {
  try {
    if (fs.existsSync(JSON_DB_PATH)) {
      const data = fs.readFileSync(JSON_DB_PATH, 'utf8');
      memoryStore = JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load JSON fallback DB:', e);
  }
}

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function initDb() {
  return new Promise((resolve, reject) => {
    if (DATABASE_URL) {
      console.log('🐘 Connecting to PostgreSQL Database...');
      isPg = true;
      pgPool = new Pool({
        connectionString: DATABASE_URL,
        ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
      });
      createPgTables().then(resolve).catch(reject);
    } else {
      try {
        const sqlite3 = require('sqlite3').verbose();
        console.log('🗄️ Using Relational SQLite Database (database.sqlite)...');
        const dbPath = path.join(__dirname, 'database.sqlite');
        sqliteDb = new sqlite3.Database(dbPath, async (err) => {
          if (err) {
            console.warn('⚠️ SQLite failed, using Pure JS Storage:', err.message);
            isJsonFallback = true;
            loadJsonFallback();
            seedJsonData();
            return resolve();
          }
          try {
            await createSqliteTables();
            resolve();
          } catch (e) {
            console.warn('⚠️ SQLite setup failed, using Pure JS Storage:', e.message);
            isJsonFallback = true;
            loadJsonFallback();
            seedJsonData();
            resolve();
          }
        });
      } catch (err) {
        console.warn('⚠️ sqlite3 native module missing, switching to Pure JS Storage');
        isJsonFallback = true;
        loadJsonFallback();
        seedJsonData();
        resolve();
      }
    }
  });
}

function seedJsonData() {
  const now = new Date().toISOString();
  if (!memoryStore.devices['brother']) {
    memoryStore.devices['brother'] = {
      id: 'brother', name: 'Брат', model: 'Android Device', battery: 100, is_online: 1, last_seen: now, current_app: 'Вне приложения', total_screen_time_seconds: 0
    };
    memoryStore.device_limits['brother'] = { device_id: 'brother', max_daily_time_seconds: 0, is_locked: 0, app_limits: '{}' };
  }
  if (!memoryStore.devices['sister']) {
    memoryStore.devices['sister'] = {
      id: 'sister', name: 'Сестренка', model: 'Android Device', battery: 100, is_online: 1, last_seen: now, current_app: 'Вне приложения', total_screen_time_seconds: 0
    };
    memoryStore.device_limits['sister'] = { device_id: 'sister', max_daily_time_seconds: 0, is_locked: 0, app_limits: '{}' };
  }
  saveJsonFallback();
}

async function createPgTables() {
  const client = await pgPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS devices (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        model VARCHAR(100),
        battery INT DEFAULT 100,
        is_online BOOLEAN DEFAULT true,
        last_seen TIMESTAMPTZ DEFAULT NOW(),
        current_app VARCHAR(100),
        total_screen_time_seconds BIGINT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS device_limits (
        device_id VARCHAR(50) PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
        max_daily_time_seconds INT DEFAULT 0,
        is_locked BOOLEAN DEFAULT false,
        app_limits JSONB DEFAULT '{}'::jsonb
      );

      CREATE TABLE IF NOT EXISTS content_logs (
        id VARCHAR(100) PRIMARY KEY,
        device_id VARCHAR(50) REFERENCES devices(id) ON DELETE CASCADE,
        app_name VARCHAR(100),
        content_text TEXT NOT NULL,
        log_type VARCHAR(50) DEFAULT 'activity',
        is_alert BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS app_usage (
        id SERIAL PRIMARY KEY,
        device_id VARCHAR(50) REFERENCES devices(id) ON DELETE CASCADE,
        package_name VARCHAR(150),
        label VARCHAR(100),
        category VARCHAR(50),
        seconds INT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS forbidden_keywords (
        id SERIAL PRIMARY KEY,
        keyword VARCHAR(100) UNIQUE NOT NULL
      );
    `);
    console.log('✅ PostgreSQL SQL Tables Verified.');
  } finally {
    client.release();
  }
}

async function createSqliteTables() {
  await runAsync(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      model TEXT,
      battery INTEGER DEFAULT 100,
      is_online INTEGER DEFAULT 1,
      last_seen TEXT,
      current_app TEXT,
      total_screen_time_seconds INTEGER DEFAULT 0
    );
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS device_limits (
      device_id TEXT PRIMARY KEY,
      max_daily_time_seconds INTEGER DEFAULT 0,
      is_locked INTEGER DEFAULT 0,
      app_limits TEXT DEFAULT '{}'
    );
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS content_logs (
      id TEXT PRIMARY KEY,
      device_id TEXT,
      app_name TEXT,
      content_text TEXT NOT NULL,
      log_type TEXT DEFAULT 'activity',
      is_alert INTEGER DEFAULT 0,
      created_at TEXT
    );
  `);

  try {
    await runAsync(`ALTER TABLE content_logs ADD COLUMN is_alert INTEGER DEFAULT 0;`);
  } catch(e) {}

  await runAsync(`
    CREATE TABLE IF NOT EXISTS app_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT,
      package_name TEXT,
      label TEXT,
      category TEXT,
      seconds INTEGER DEFAULT 0
    );
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS forbidden_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT UNIQUE NOT NULL
    );
  `);

  await seedInitialSqliteData();
  console.log('✅ SQLite SQL Tables Verified.');
}

async function seedInitialSqliteData() {
  const row = await getAsync("SELECT COUNT(*) as count FROM devices");
  if (!row || row.count === 0) {
    console.log("Seeding base device records...");
    const now = new Date().toISOString();
    await runAsync(`INSERT INTO devices (id, name, model, battery, is_online, last_seen, current_app, total_screen_time_seconds)
                    VALUES ('brother', 'Брат', 'Android Device', 100, 1, ?, 'Вне приложения', 0)`, [now]);
    await runAsync(`INSERT INTO device_limits (device_id, max_daily_time_seconds, is_locked, app_limits)
                    VALUES ('brother', 0, 0, '{}')`);

    await runAsync(`INSERT INTO devices (id, name, model, battery, is_online, last_seen, current_app, total_screen_time_seconds)
                    VALUES ('sister', 'Сестренка', 'Android Device', 100, 1, ?, 'Вне приложения', 0)`, [now]);
    await runAsync(`INSERT INTO device_limits (device_id, max_daily_time_seconds, is_locked, app_limits)
                    VALUES ('sister', 0, 0, '{}')`);
  }

  const kwRow = await getAsync("SELECT COUNT(*) as count FROM forbidden_keywords");
  if (!kwRow || kwRow.count === 0) {
    const defaults = ['казино', 'ставка', 'порно', 'наркотики', 'суицид', 'взлом'];
    for (const kw of defaults) {
      try {
        await runAsync(`INSERT OR IGNORE INTO forbidden_keywords (keyword) VALUES (?)`, [kw]);
      } catch (e) {}
    }
  }
}

async function getForbiddenKeywords() {
  if (isPg) {
    const res = await pgPool.query(`SELECT keyword FROM forbidden_keywords ORDER BY id ASC`);
    return res.rows.map(r => r.keyword);
  } else if (isJsonFallback) {
    return memoryStore.forbidden_keywords || [];
  } else {
    const rows = await allAsync(`SELECT keyword FROM forbidden_keywords ORDER BY id ASC`);
    return rows.map(r => r.keyword);
  }
}

async function addForbiddenKeyword(keyword) {
  const clean = keyword.trim().toLowerCase();
  if (!clean) return;
  if (isPg) {
    await pgPool.query(`INSERT INTO forbidden_keywords (keyword) VALUES ($1) ON CONFLICT DO NOTHING`, [clean]);
  } else if (isJsonFallback) {
    if (!memoryStore.forbidden_keywords.includes(clean)) {
      memoryStore.forbidden_keywords.push(clean);
      saveJsonFallback();
    }
  } else {
    await runAsync(`INSERT OR IGNORE INTO forbidden_keywords (keyword) VALUES (?)`, [clean]);
  }
}

async function deleteForbiddenKeyword(keyword) {
  const clean = keyword.trim().toLowerCase();
  if (isPg) {
    await pgPool.query(`DELETE FROM forbidden_keywords WHERE LOWER(keyword) = $1`, [clean]);
  } else if (isJsonFallback) {
    memoryStore.forbidden_keywords = memoryStore.forbidden_keywords.filter(k => k.toLowerCase() !== clean);
    saveJsonFallback();
  } else {
    await runAsync(`DELETE FROM forbidden_keywords WHERE LOWER(keyword) = ?`, [clean]);
  }
}

async function getAllDevicesStats() {
  const keywords = await getForbiddenKeywords();
  if (isPg) {
    const res = await pgPool.query(`
      SELECT d.*, l.max_daily_time_seconds, l.is_locked, l.app_limits
      FROM devices d
      LEFT JOIN device_limits l ON d.id = l.device_id
    `);
    const devicesMap = {};
    for (const row of res.rows) {
      const logsRes = await pgPool.query(`SELECT * FROM content_logs WHERE device_id = $1 ORDER BY created_at DESC LIMIT 50`, [row.id]);
      const appsRes = await pgPool.query(`SELECT * FROM app_usage WHERE device_id = $1 ORDER BY seconds DESC`, [row.id]);

      devicesMap[row.id] = {
        id: row.id,
        name: row.name,
        model: row.model,
        battery: row.battery,
        isOnline: row.is_online,
        lastSeen: row.last_seen,
        currentApp: row.current_app,
        totalScreenTimeSeconds: parseInt(row.total_screen_time_seconds || 0),
        limits: {
          maxDailyTimeSeconds: (row.max_daily_time_seconds !== undefined && row.max_daily_time_seconds !== null) ? row.max_daily_time_seconds : 0,
          isLocked: !!row.is_locked,
          appLimits: row.app_limits || {}
        },
        apps: appsRes.rows,
        logs: logsRes.rows.map(l => ({
          id: l.id,
          timestamp: l.created_at,
          app: l.app_name,
          content: l.content_text,
          type: l.log_type,
          isAlert: !!l.is_alert
        })),
        keywords: keywords
      };
    }
    return devicesMap;
  } else if (isJsonFallback) {
    const devicesMap = {};
    for (const id of ['brother', 'sister']) {
      const d = memoryStore.devices[id] || {};
      const l = memoryStore.device_limits[id] || {};
      const devLogs = memoryStore.content_logs.filter(log => log.device_id === id).slice(-50).reverse();
      const devApps = memoryStore.app_usage.filter(app => app.device_id === id);

      let parsedAppLimits = {};
      try { parsedAppLimits = JSON.parse(l.app_limits || '{}'); } catch(e){}

      devicesMap[id] = {
        id: d.id || id,
        name: d.name || id,
        model: d.model || 'Android',
        battery: d.battery || 100,
        isOnline: !!d.is_online,
        lastSeen: d.last_seen,
        currentApp: d.current_app,
        totalScreenTimeSeconds: d.total_screen_time_seconds || 0,
        limits: {
          maxDailyTimeSeconds: (l.max_daily_time_seconds !== undefined && l.max_daily_time_seconds !== null) ? l.max_daily_time_seconds : 0,
          isLocked: !!l.is_locked,
          appLimits: parsedAppLimits
        },
        apps: devApps,
        logs: devLogs,
        keywords: keywords
      };
    }
    return devicesMap;
  } else {
    const rows = await allAsync(`
      SELECT d.*, l.max_daily_time_seconds, l.is_locked, l.app_limits
      FROM devices d
      LEFT JOIN device_limits l ON d.id = l.device_id
    `);

    const devicesMap = {};
    for (const row of rows) {
      const logs = await allAsync(`SELECT * FROM content_logs WHERE device_id = ? ORDER BY created_at DESC LIMIT 50`, [row.id]);
      const apps = await allAsync(`SELECT * FROM app_usage WHERE device_id = ? ORDER BY seconds DESC`, [row.id]);

      let parsedAppLimits = {};
      try { parsedAppLimits = JSON.parse(row.app_limits || '{}'); } catch(e){}

      devicesMap[row.id] = {
        id: row.id,
        name: row.name,
        model: row.model,
        battery: row.battery,
        isOnline: !!row.is_online,
        lastSeen: row.last_seen,
        currentApp: row.current_app,
        totalScreenTimeSeconds: row.total_screen_time_seconds || 0,
        limits: {
          maxDailyTimeSeconds: (row.max_daily_time_seconds !== undefined && row.max_daily_time_seconds !== null) ? row.max_daily_time_seconds : 0,
          isLocked: !!row.is_locked,
          appLimits: parsedAppLimits
        },
        apps: apps,
        logs: logs.map(l => ({
          id: l.id,
          timestamp: l.created_at,
          app: l.app_name,
          content: l.content_text,
          type: l.log_type,
          isAlert: !!l.is_alert
        })),
        keywords: keywords
      };
    }
    return devicesMap;
  }
}

async function updateHeartbeat(deviceId, name, model, battery, currentApp) {
  const now = new Date().toISOString();
  if (isPg) {
    await pgPool.query(`
      INSERT INTO devices (id, name, model, battery, is_online, last_seen, current_app)
      VALUES ($1, $2, $3, $4, true, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        battery = EXCLUDED.battery,
        is_online = true,
        last_seen = EXCLUDED.last_seen,
        current_app = EXCLUDED.current_app;
    `, [deviceId, name || deviceId, model || 'Android', battery || 100, now, currentApp || 'Вне приложения']);
  } else if (isJsonFallback) {
    if (!memoryStore.devices[deviceId]) memoryStore.devices[deviceId] = { id: deviceId, name: name || deviceId };
    const dev = memoryStore.devices[deviceId];
    dev.battery = battery || 100;
    dev.is_online = 1;
    dev.last_seen = now;
    dev.current_app = currentApp || 'Вне приложения';
    saveJsonFallback();
  } else {
    await runAsync(`
      INSERT INTO devices (id, name, model, battery, is_online, last_seen, current_app)
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        battery = excluded.battery,
        is_online = 1,
        last_seen = excluded.last_seen,
        current_app = excluded.current_app;
    `, [deviceId, name || deviceId, model || 'Android', battery || 100, now, currentApp || 'Вне приложения']);
  }
}

async function updateAppUsage(deviceId, apps, totalScreenTimeSeconds) {
  if (isPg) {
    await pgPool.query(`DELETE FROM app_usage WHERE device_id = $1`, [deviceId]);
    for (const a of apps) {
      await pgPool.query(`
        INSERT INTO app_usage (device_id, package_name, label, category, seconds)
        VALUES ($1, $2, $3, $4, $5);
      `, [deviceId, a.packageName, a.label, a.category || 'Other', a.seconds || 0]);
    }
    if (totalScreenTimeSeconds !== undefined) {
      await pgPool.query(`UPDATE devices SET total_screen_time_seconds = $1 WHERE id = $2`, [totalScreenTimeSeconds, deviceId]);
    }
  } else if (isJsonFallback) {
    memoryStore.app_usage = memoryStore.app_usage.filter(a => a.device_id !== deviceId);
    for (const a of apps) {
      memoryStore.app_usage.push({
        device_id: deviceId, package_name: a.packageName, label: a.label, category: a.category || 'Other', seconds: a.seconds || 0
      });
    }
    if (totalScreenTimeSeconds !== undefined && memoryStore.devices[deviceId]) {
      memoryStore.devices[deviceId].total_screen_time_seconds = totalScreenTimeSeconds;
    }
    saveJsonFallback();
  } else {
    await runAsync(`DELETE FROM app_usage WHERE device_id = ?`, [deviceId]);
    for (const a of apps) {
      await runAsync(`
        INSERT INTO app_usage (device_id, package_name, label, category, seconds)
        VALUES (?, ?, ?, ?, ?);
      `, [deviceId, a.packageName, a.label, a.category || 'Other', a.seconds || 0]);
    }
    if (totalScreenTimeSeconds !== undefined) {
      await runAsync(`UPDATE devices SET total_screen_time_seconds = ? WHERE id = ?`, [totalScreenTimeSeconds, deviceId]);
    }
  }
}

async function addContentLog(deviceId, appName, contentText, logType) {
  const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  const now = new Date().toISOString();

  const keywords = await getForbiddenKeywords();
  const lowerContent = contentText.toLowerCase();
  let isAlert = false;
  for (const kw of keywords) {
    if (lowerContent.includes(kw.toLowerCase())) {
      isAlert = true;
      break;
    }
  }

  const finalType = isAlert ? 'alert' : (logType || 'activity');

  if (isPg) {
    await pgPool.query(`
      INSERT INTO content_logs (id, device_id, app_name, content_text, log_type, is_alert, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7);
    `, [logId, deviceId, appName, contentText, finalType, isAlert, now]);
    await pgPool.query(`UPDATE devices SET current_app = $1, last_seen = $2 WHERE id = $3;`, [appName, now, deviceId]);
  } else if (isJsonFallback) {
    memoryStore.content_logs.push({
      id: logId, device_id: deviceId, app_name: appName, content_text: contentText, log_type: finalType, is_alert: isAlert, created_at: now
    });
    if (memoryStore.devices[deviceId]) {
      memoryStore.devices[deviceId].current_app = appName;
      memoryStore.devices[deviceId].last_seen = now;
    }
    saveJsonFallback();
  } else {
    await runAsync(`
      INSERT INTO content_logs (id, device_id, app_name, content_text, log_type, is_alert, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?);
    `, [logId, deviceId, appName, contentText, finalType, isAlert ? 1 : 0, now]);
    await runAsync(`UPDATE devices SET current_app = ?, last_seen = ? WHERE id = ?;`, [appName, now, deviceId]);
  }
}

async function updateDeviceLimits(deviceId, maxDailyTimeSeconds, appLimits) {
  if (isPg) {
    if (maxDailyTimeSeconds !== undefined && maxDailyTimeSeconds !== null) {
      await pgPool.query(`
        INSERT INTO device_limits (device_id, max_daily_time_seconds)
        VALUES ($1, $2)
        ON CONFLICT (device_id) DO UPDATE SET max_daily_time_seconds = $2;
      `, [deviceId, maxDailyTimeSeconds]);
    }
    if (appLimits !== undefined) {
      await pgPool.query(`
        INSERT INTO device_limits (device_id, app_limits)
        VALUES ($1, $2)
        ON CONFLICT (device_id) DO UPDATE SET app_limits = $2;
      `, [deviceId, JSON.stringify(appLimits)]);
    }
  } else if (isJsonFallback) {
    if (!memoryStore.device_limits[deviceId]) memoryStore.device_limits[deviceId] = { device_id: deviceId, max_daily_time_seconds: 0, is_locked: 0, app_limits: '{}' };
    const l = memoryStore.device_limits[deviceId];
    if (maxDailyTimeSeconds !== undefined && maxDailyTimeSeconds !== null) l.max_daily_time_seconds = maxDailyTimeSeconds;
    if (appLimits !== undefined) l.app_limits = JSON.stringify(appLimits);
    saveJsonFallback();
  } else {
    if (maxDailyTimeSeconds !== undefined && maxDailyTimeSeconds !== null) {
      await runAsync(`
        INSERT INTO device_limits (device_id, max_daily_time_seconds)
        VALUES (?, ?)
        ON CONFLICT(device_id) DO UPDATE SET max_daily_time_seconds = excluded.max_daily_time_seconds;
      `, [deviceId, maxDailyTimeSeconds]);
    }
    if (appLimits !== undefined) {
      await runAsync(`
        INSERT INTO device_limits (device_id, app_limits)
        VALUES (?, ?)
        ON CONFLICT(device_id) DO UPDATE SET app_limits = excluded.app_limits;
      `, [deviceId, JSON.stringify(appLimits)]);
    }
  }
}

async function setDeviceLockStatus(deviceId, isLocked) {
  const lockVal = isLocked ? 1 : 0;
  if (isPg) {
    await pgPool.query(`
      INSERT INTO device_limits (device_id, is_locked)
      VALUES ($1, $2)
      ON CONFLICT (device_id) DO UPDATE SET is_locked = $2;
    `, [deviceId, !!isLocked]);
  } else if (isJsonFallback) {
    if (!memoryStore.device_limits[deviceId]) memoryStore.device_limits[deviceId] = { device_id: deviceId, max_daily_time_seconds: 0, is_locked: 0, app_limits: '{}' };
    memoryStore.device_limits[deviceId].is_locked = lockVal;
    saveJsonFallback();
  } else {
    await runAsync(`
      INSERT INTO device_limits (device_id, is_locked)
      VALUES (?, ?)
      ON CONFLICT(device_id) DO UPDATE SET is_locked = excluded.is_locked;
    `, [deviceId, lockVal]);
  }
}

module.exports = {
  initDb,
  getAllDevicesStats,
  updateHeartbeat,
  updateAppUsage,
  addContentLog,
  updateDeviceLimits,
  setDeviceLockStatus,
  getForbiddenKeywords,
  addForbiddenKeyword,
  deleteForbiddenKeyword
};
