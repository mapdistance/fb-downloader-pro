const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');

const DB_PATH = path.join(__dirname, 'database.db');
const BACKUP_DIR = path.join(__dirname, 'backups');

// Ensure backup directory exists
fs.ensureDirSync(BACKUP_DIR);

const db = new sqlite3.Database(DB_PATH);

// Database configuration
db.configure('busyTimeout', 5000);

// Initialize database
function initDatabase() {
  console.log('📦 Initializing database...');
  
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
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
  )`);
  
  // Download history table
  db.run(`CREATE TABLE IF NOT EXISTS downloads (
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
  )`);
  
  // API usage table
  db.run(`CREATE TABLE IF NOT EXISTS api_usage (
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
  )`);
  
  // Settings table
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    type TEXT DEFAULT 'string',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // Notifications table
  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    type TEXT,
    title TEXT,
    message TEXT,
    data TEXT,
    read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  
  // Analytics events table
  db.run(`CREATE TABLE IF NOT EXISTS analytics_events (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    event_type TEXT,
    event_data TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  )`);
  
  // Cache table
  db.run(`CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    value TEXT,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // Download queue table
  db.run(`CREATE TABLE IF NOT EXISTS download_queue (
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
  )`);
  
  // Create indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_downloads_user ON downloads(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_downloads_created ON downloads(downloaded_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_api_usage_key ON api_usage(api_key)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_cache_key ON cache(key)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_analytics_events ON analytics_events(event_type, created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read)`);
  
  // Insert default settings
  const defaultSettings = [
    { key: 'site_name', value: 'FB Downloader Pro', type: 'string' },
    { key: 'site_description', value: 'Download Facebook videos, reels, and stories in HD quality', type: 'string' },
    { key: 'max_download_size', value: '104857600', type: 'number' },
    { key: 'allowed_formats', value: JSON.stringify(['mp4', 'mp3', 'avi', 'mkv', 'webm']), type: 'json' },
    { key: 'maintenance_mode', value: 'false', type: 'boolean' },
    { key: 'version', value: '1.0.0', type: 'string' }
  ];
  
  defaultSettings.forEach(setting => {
    db.run('INSERT OR IGNORE INTO settings (key, value, type) VALUES (?, ?, ?)', 
      [setting.key, setting.value, setting.type]);
  });
  
  console.log('✅ Database initialized successfully');
}

// User operations
function createUser(userData) {
  return new Promise((resolve, reject) => {
    const id = uuidv4();
    const apiKey = 'fb_' + uuidv4().replace(/-/g, '').slice(0, 30);
    
    bcrypt.hash(userData.password, 10, (err, hash) => {
      if (err) return reject(err);
      
      const now = new Date().toISOString();
      
      db.run(
        `INSERT INTO users (
          id, username, email, password, api_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, userData.username, userData.email, hash, apiKey, now, now],
        function(err) {
          if (err) return reject(err);
          
          resolve({ 
            id, 
            username: userData.username, 
            email: userData.email, 
            apiKey
          });
        }
      );
    });
  });
}

function findUserByEmail(email) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE email = ? AND is_active = 1 AND is_banned = 0', [email], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function findUserById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function findUserByApiKey(apiKey) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE api_key = ? AND is_active = 1', [apiKey], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function updateLoginInfo(userId, ipAddress) {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    db.run(
      'UPDATE users SET last_login = ?, last_login_ip = ?, login_count = login_count + 1, updated_at = ? WHERE id = ?',
      [now, ipAddress, now, userId],
      function(err) {
        if (err) return reject(err);
        resolve(this.changes);
      }
    );
  });
}

// Download history operations
function addDownloadHistory(userId, data) {
  return new Promise((resolve, reject) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    
    db.run(
      `INSERT INTO downloads (
        id, user_id, video_url, title, type, format, quality, 
        file_size, file_path, status, downloaded_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, userId, data.url, data.title, data.type, data.format, 
        data.quality, data.fileSize, data.filePath, data.status || 'completed', now, expiresAt
      ],
      function(err) {
        if (err) return reject(err);
        
        // Update user's download count
        if (userId) {
          db.run(
            'UPDATE users SET total_downloads = total_downloads + 1, updated_at = ? WHERE id = ?',
            [now, userId],
            () => {}
          );
        }
        
        resolve(id);
      }
    );
  });
}

function getDownloadHistory(userId, limit = 20, offset = 0) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM downloads WHERE user_id = ? ORDER BY downloaded_at DESC LIMIT ? OFFSET ?',
      [userId, limit, offset],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

// Cache operations
function setCache(key, value, expiresInSeconds = 3600) {
  return new Promise((resolve, reject) => {
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    const now = new Date().toISOString();
    
    db.run(
      'INSERT OR REPLACE INTO cache (key, value, expires_at, created_at) VALUES (?, ?, ?, ?)',
      [key, JSON.stringify(value), expiresAt, now],
      function(err) {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}

function getCache(key) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM cache WHERE key = ?', [key], (err, row) => {
      if (err) return reject(err);
      
      if (!row) return resolve(null);
      
      const now = new Date();
      const expiresAt = new Date(row.expires_at);
      
      if (now > expiresAt) {
        db.run('DELETE FROM cache WHERE key = ?', [key], () => {});
        return resolve(null);
      }
      
      resolve(JSON.parse(row.value));
    });
  });
}

// Analytics operations
function trackEvent(userId, eventType, eventData = {}) {
  return new Promise((resolve, reject) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    
    db.run(
      'INSERT INTO analytics_events (id, user_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, userId, eventType, JSON.stringify(eventData), now],
      function(err) {
        if (err) return reject(err);
        resolve(id);
      }
    );
  });
}

// Notification operations
function createNotification(userId, type, title, message, data = {}) {
  return new Promise((resolve, reject) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    
    db.run(
      'INSERT INTO notifications (id, user_id, type, title, message, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, userId, type, title, message, JSON.stringify(data), now],
      function(err) {
        if (err) return reject(err);
        resolve(id);
      }
    );
  });
}

function getNotifications(userId, limit = 20, unreadOnly = false) {
  return new Promise((resolve, reject) => {
    let query = 'SELECT * FROM notifications WHERE user_id = ?';
    const params = [userId];
    
    if (unreadOnly) {
      query += ' AND read = 0';
    }
    
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    
    db.all(query, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function markNotificationRead(notificationId, userId) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?',
      [notificationId, userId],
      function(err) {
        if (err) return reject(err);
        resolve(this.changes);
      }
    );
  });
}

// Stats operations
function getStats() {
  return new Promise((resolve, reject) => {
    const stats = {};
    
    db.get('SELECT COUNT(*) as total_users FROM users', (err, row) => {
      if (err) return reject(err);
      stats.total_users = row.total_users;
      
      db.get('SELECT COUNT(*) as total_downloads FROM downloads', (err, row) => {
        if (err) return reject(err);
        stats.total_downloads = row.total_downloads;
        
        db.get('SELECT COUNT(*) as premium_users FROM users WHERE is_premium = 1', (err, row) => {
          if (err) return reject(err);
          stats.premium_users = row.premium_users;
          
          db.get('SELECT COUNT(*) as active_today FROM users WHERE last_login >= date(\'now\')', (err, row) => {
            if (err) return reject(err);
            stats.active_today = row.active_today;
            resolve(stats);
          });
        });
      });
    });
  });
}

// Database backup
function backupDatabase() {
  return new Promise((resolve, reject) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}.db`);
    
    db.backup(backupPath, (err) => {
      if (err) return reject(err);
      
      // Clean up old backups (keep last 7 days)
      fs.readdir(BACKUP_DIR, (err, files) => {
        if (err) return resolve(backupPath);
        
        const now = Date.now();
        files.forEach(file => {
          const filePath = path.join(BACKUP_DIR, file);
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > 7 * 24 * 60 * 60 * 1000) {
            fs.remove(filePath).catch(() => {});
          }
        });
        
        resolve(backupPath);
      });
    });
  });
}

module.exports = {
  initDatabase,
  createUser,
  findUserByEmail,
  findUserById,
  findUserByApiKey,
  updateLoginInfo,
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