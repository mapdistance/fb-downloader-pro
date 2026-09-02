const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');

const DB_PATH = path.join(__dirname, 'database.db');
const BACKUP_DIR = path.join(__dirname, 'backups');

// Ensure backup directory exists
fs.ensureDirSync(BACKUP_DIR);

// Create database connection
let db;
try {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  console.log('📦 Database connected');
} catch (error) {
  console.error('❌ Database connection error:', error);
  process.exit(1);
}

// Initialize database
function initDatabase() {
  console.log('📦 Initializing database...');
  
  try {
    // Create all tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        api_key TEXT UNIQUE,
        avatar TEXT,
        is_premium INTEGER DEFAULT 0,
        is_admin INTEGER DEFAULT 0,
        premium_expires_at DATETIME,
        premium_plan TEXT,
        email_verified INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME,
        last_login_ip TEXT,
        login_count INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        is_banned INTEGER DEFAULT 0,
        ban_reason TEXT,
        timezone TEXT DEFAULT 'UTC',
        locale TEXT DEFAULT 'en',
        total_downloads INTEGER DEFAULT 0,
        total_api_calls INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS downloads (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        video_url TEXT,
        facebook_id TEXT,
        title TEXT,
        description TEXT,
        type TEXT,
        format TEXT,
        quality TEXT,
        file_size TEXT,
        file_path TEXT,
        thumbnail_url TEXT,
        duration INTEGER,
        status TEXT DEFAULT 'completed',
        error_message TEXT,
        ip_address TEXT,
        user_agent TEXT,
        downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS api_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key TEXT,
        user_id TEXT,
        endpoint TEXT,
        method TEXT,
        requests INTEGER DEFAULT 0,
        successful_requests INTEGER DEFAULT 0,
        failed_requests INTEGER DEFAULT 0,
        last_used DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        type TEXT DEFAULT 'string',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        type TEXT,
        title TEXT,
        message TEXT,
        data TEXT,
        read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS analytics_events (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        event_type TEXT,
        event_data TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS download_queue (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        url TEXT,
        type TEXT,
        format TEXT,
        quality TEXT,
        status TEXT DEFAULT 'pending',
        priority INTEGER DEFAULT 0,
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME,
        completed_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    // Create indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);
      CREATE INDEX IF NOT EXISTS idx_downloads_user ON downloads(user_id);
      CREATE INDEX IF NOT EXISTS idx_downloads_created ON downloads(downloaded_at);
      CREATE INDEX IF NOT EXISTS idx_api_usage_key ON api_usage(api_key);
      CREATE INDEX IF NOT EXISTS idx_cache_key ON cache(key);
      CREATE INDEX IF NOT EXISTS idx_analytics_events ON analytics_events(event_type, created_at);
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
    `);

    // Insert default settings
    const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value, type) VALUES (?, ?, ?)');
    
    const defaultSettings = [
      { key: 'site_name', value: 'FB Downloader Pro', type: 'string' },
      { key: 'site_description', value: 'Download Facebook videos, reels, and stories in HD quality', type: 'string' },
      { key: 'max_download_size', value: '104857600', type: 'number' },
      { key: 'allowed_formats', value: JSON.stringify(['mp4', 'mp3', 'avi', 'mkv', 'webm']), type: 'json' },
      { key: 'maintenance_mode', value: 'false', type: 'boolean' },
      { key: 'version', value: '1.0.1', type: 'string' }
    ];

    const insertMany = db.transaction((settings) => {
      for (const setting of settings) {
        insertSetting.run(setting.key, setting.value, setting.type);
      }
    });

    insertMany(defaultSettings);
    
    console.log('✅ Database initialized successfully');
    console.log('✅ Tables created: users, downloads, api_usage, settings, notifications, analytics_events, cache, download_queue');
    
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  }
}

// User operations
function createUser(userData) {
  const id = uuidv4();
  const apiKey = 'fb_' + uuidv4().replace(/-/g, '').slice(0, 30);
  const hash = bcrypt.hashSync(userData.password, 10);
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO users (id, username, email, password, api_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(id, userData.username, userData.email, hash, apiKey, now, now);
  
  return { 
    id, 
    username: userData.username, 
    email: userData.email, 
    apiKey 
  };
}

function findUserByEmail(email) {
  const stmt = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1 AND is_banned = 0');
  return stmt.get(email);
}

function findUserById(id) {
  const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
  return stmt.get(id);
}

function findUserByApiKey(apiKey) {
  const stmt = db.prepare('SELECT * FROM users WHERE api_key = ? AND is_active = 1');
  return stmt.get(apiKey);
}

function updateLoginInfo(userId, ipAddress) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE users 
    SET last_login = ?, last_login_ip = ?, login_count = login_count + 1, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(now, ipAddress, now, userId);
}

function updateUser(userId, updates) {
  const allowedFields = ['username', 'avatar', 'timezone', 'locale', 'is_active'];
  const fields = [];
  const values = [];
  
  Object.keys(updates).forEach(key => {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = ?`);
      values.push(updates[key]);
    }
  });
  
  if (fields.length === 0) return;
  
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(userId);
  
  const stmt = db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);
}

// Download history operations
function addDownloadHistory(userId, data) {
  const id = uuidv4();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO downloads (
      id, user_id, video_url, title, type, format, quality, 
      file_size, file_path, status, downloaded_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    id, userId, data.url, data.title || '', data.type, data.format, 
    data.quality, data.fileSize || '', data.filePath || '', 
    data.status || 'completed', now, expiresAt
  );
  
  // Update user's download count
  if (userId) {
    const updateStmt = db.prepare('UPDATE users SET total_downloads = total_downloads + 1 WHERE id = ?');
    updateStmt.run(userId);
  }
  
  return id;
}

function getDownloadHistory(userId, limit = 20, offset = 0) {
  const stmt = db.prepare(`
    SELECT * FROM downloads 
    WHERE user_id = ? 
    ORDER BY downloaded_at DESC 
    LIMIT ? OFFSET ?
  `);
  return stmt.all(userId, limit, offset);
}

// Cache operations
function setCache(key, value, expiresInSeconds = 3600) {
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO cache (key, value, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `);
  
  stmt.run(key, JSON.stringify(value), expiresAt, now);
}

function getCache(key) {
  const stmt = db.prepare('SELECT * FROM cache WHERE key = ?');
  const row = stmt.get(key);
  
  if (!row) return null;
  
  const now = new Date();
  const expiresAt = new Date(row.expires_at);
  
  if (now > expiresAt) {
    const deleteStmt = db.prepare('DELETE FROM cache WHERE key = ?');
    deleteStmt.run(key);
    return null;
  }
  
  return JSON.parse(row.value);
}

// Analytics
function trackEvent(userId, eventType, eventData = {}) {
  const id = uuidv4();
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO analytics_events (id, user_id, event_type, event_data, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  stmt.run(id, userId, eventType, JSON.stringify(eventData), now);
  return id;
}

// Notifications
function createNotification(userId, type, title, message, data = {}) {
  const id = uuidv4();
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, message, data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(id, userId, type, title, message, JSON.stringify(data), now);
  return id;
}

function getNotifications(userId, limit = 20, unreadOnly = false) {
  let query = 'SELECT * FROM notifications WHERE user_id = ?';
  const params = [userId];
  
  if (unreadOnly) {
    query += ' AND read = 0';
  }
  
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  
  const stmt = db.prepare(query);
  return stmt.all(...params);
}

function markNotificationRead(notificationId, userId) {
  const stmt = db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?');
  stmt.run(notificationId, userId);
}

// Stats
function getStats() {
  const stats = {};
  
  stats.total_users = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  stats.total_downloads = db.prepare('SELECT COUNT(*) as count FROM downloads').get().count;
  stats.premium_users = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_premium = 1').get().count;
  stats.active_today = db.prepare("SELECT COUNT(*) as count FROM users WHERE last_login >= date('now')").get().count;
  
  return stats;
}

// Database backup
function backupDatabase() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}.db`);
  
  db.backup(backupPath);
  
  // Clean old backups
  const files = fs.readdirSync(BACKUP_DIR);
  const now = Date.now();
  files.forEach(file => {
    const filePath = path.join(BACKUP_DIR, file);
    const stats = fs.statSync(filePath);
    if (now - stats.mtimeMs > 7 * 24 * 60 * 60 * 1000) {
      fs.removeSync(filePath);
    }
  });
  
  return backupPath;
}

// Export all functions
module.exports = {
  initDatabase,
  createUser,
  findUserByEmail,
  findUserById,
  findUserByApiKey,
  updateLoginInfo,
  updateUser,
  addDownloadHistory,
  getDownloadHistory,
  setCache,
  getCache,
  trackEvent,
  createNotification,
  getNotifications,
  markNotificationRead,
  getStats,
  backupDatabase,
  db
};
