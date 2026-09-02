require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const { 
  initDatabase, 
  createUser, 
  findUserByEmail, 
  addDownloadHistory, 
  getDownloadHistory, 
  getStats 
} = require('./database');

const { 
  generateToken, 
  verifyToken, 
  revokeToken, 
  verifyApiKey, 
  optionalAuth, 
  requireAdmin, 
  comparePassword 
} = require('./auth');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, error: 'Too many requests' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: 'Too many login attempts' }
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Temp directory
const TEMP_DIR = path.join(__dirname, 'temp');
fs.ensureDirSync(TEMP_DIR);

// yt-dlp path (Render.com-এ pip install হয়)
const YTDLP_PATH = 'yt-dlp'; // Use system PATH

// Cleanup job
setInterval(async () => {
  try {
    const files = await fs.readdir(TEMP_DIR);
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      const stats = await fs.stat(filePath);
      if (now - stats.mtimeMs > 3600000) {
        await fs.remove(filePath);
      }
    }
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}, 1800000);

// ===== HEALTH CHECK =====
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.1',
    database: 'connected'
  });
});

// ===== AUTH ROUTES =====
app.post('/api/register', authLimiter, async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ 
        success: false,
        error: 'All fields required',
        code: 'FIELDS_REQUIRED'
      });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ 
        success: false,
        error: 'Password must be at least 6 characters',
        code: 'PASSWORD_TOO_SHORT'
      });
    }
    
    const existingUser = findUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ 
        success: false,
        error: 'Email already registered',
        code: 'EMAIL_EXISTS'
      });
    }
    
    const user = createUser({ username, email, password });
    const token = generateToken(user);
    
    res.json({
      success: true,
      token,
      user: { 
        id: user.id, 
        username: user.username, 
        email: user.email, 
        api_key: user.apiKey 
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Registration failed',
      code: 'REGISTRATION_ERROR'
    });
  }
});

app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false,
        error: 'Email and password required',
        code: 'CREDENTIALS_REQUIRED'
      });
    }
    
    const user = findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }
    
    const validPassword = await comparePassword(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }
    
    const token = generateToken(user);
    
    res.json({
      success: true,
      token,
      user: { 
        id: user.id, 
        username: user.username, 
        email: user.email, 
        api_key: user.api_key, 
        is_premium: user.is_premium 
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Login failed',
      code: 'LOGIN_ERROR'
    });
  }
});

app.post('/api/logout', verifyToken, (req, res) => {
  revokeToken(req.token);
  res.json({ success: true, message: 'Logged out successfully' });
});

// ===== DOWNLOAD ROUTES =====
app.post('/api/download-video', optionalAuth, apiLimiter, async (req, res) => {
  try {
    const { url, quality = 'best' } = req.body;
    
    if (!url) {
      return res.status(400).json({ 
        success: false,
        error: 'URL required',
        code: 'URL_REQUIRED'
      });
    }
    
    const conversionId = uuidv4();
    const outputPath = path.join(TEMP_DIR, `${conversionId}.mp4`);
    
    const formatMap = {
      '144': 'best[height<=144]',
      '360': 'best[height<=360]',
      '480': 'best[height<=480]',
      '720': 'best[height<=720]',
      '1080': 'best[height<=1080]',
      'best': 'best'
    };
    
    const format = formatMap[quality] || 'best';
    
    await execPromise(`"${YTDLP_PATH}" -f "${format}" -o "${outputPath}" --no-warnings "${url}"`, {
      timeout: 300000,
      maxBuffer: 1024 * 1024 * 10
    });
    
    if (!await fs.pathExists(outputPath)) {
      throw new Error('File not created');
    }
    
    const downloadUrl = `/api/download/${conversionId}`;
    
    if (req.user) {
      addDownloadHistory(req.user.id, { 
        url, 
        type: 'video', 
        format: 'mp4', 
        quality 
      });
    }
    
    setTimeout(() => fs.remove(outputPath).catch(() => {}), 3600000);
    
    res.json({ 
      success: true, 
      downloadUrl, 
      fileName: `video-${conversionId.slice(0, 8)}.mp4` 
    });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Download failed',
      code: 'DOWNLOAD_ERROR'
    });
  }
});

app.post('/api/convert-audio', optionalAuth, apiLimiter, async (req, res) => {
  try {
    const { url, quality = '128', format = 'mp3' } = req.body;
    
    if (!url) {
      return res.status(400).json({ 
        success: false,
        error: 'URL required',
        code: 'URL_REQUIRED'
      });
    }
    
    const conversionId = uuidv4();
    const outputPath = path.join(TEMP_DIR, `${conversionId}.${format}`);
    
    await execPromise(`"${YTDLP_PATH}" -x --audio-format ${format} --audio-quality ${quality} -o "${outputPath}" --no-warnings "${url}"`, {
      timeout: 300000,
      maxBuffer: 1024 * 1024 * 10
    });
    
    if (!await fs.pathExists(outputPath)) {
      throw new Error('File not created');
    }
    
    const downloadUrl = `/api/download/${conversionId}`;
    
    if (req.user) {
      addDownloadHistory(req.user.id, { 
        url, 
        type: 'audio', 
        format, 
        quality 
      });
    }
    
    setTimeout(() => fs.remove(outputPath).catch(() => {}), 3600000);
    
    res.json({ 
      success: true, 
      downloadUrl, 
      fileName: `audio-${conversionId.slice(0, 8)}.${format}` 
    });
  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Conversion failed',
      code: 'CONVERSION_ERROR'
    });
  }
});

// ===== HISTORY ROUTES =====
app.get('/api/history', verifyToken, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    
    const history = getDownloadHistory(req.user.id, parseInt(limit), parseInt(offset));
    
    res.json({ 
      success: true, 
      history 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to get history',
      code: 'HISTORY_ERROR'
    });
  }
});

// ===== FILE DOWNLOAD =====
app.get('/api/download/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const files = await fs.readdir(TEMP_DIR);
    const file = files.find(f => f.startsWith(id));
    
    if (!file) {
      return res.status(404).json({ 
        success: false,
        error: 'File not found or expired',
        code: 'FILE_NOT_FOUND'
      });
    }
    
    const filePath = path.join(TEMP_DIR, file);
    res.download(filePath);
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Download failed',
      code: 'FILE_DOWNLOAD_ERROR'
    });
  }
});

// ===== ADMIN ROUTES =====
app.get('/api/admin/stats', verifyToken, requireAdmin, async (req, res) => {
  try {
    const stats = getStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to get stats',
      code: 'STATS_ERROR'
    });
  }
});

// ===== ROOT ROUTE =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    code: 'NOT_FOUND'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    code: 'INTERNAL_ERROR'
  });
});

// Start server
async function startServer() {
  try {
    // Initialize database first
    initDatabase();
    console.log('✅ Database ready');
    
    // Start server
    app.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════╗
║     🚀 FB Downloader Pro v1.0.1            ║
║     ✅ Server running on port ${PORT}         ║
║     💾 Database: SQLite (Ready)            ║
║     🔒 Security: Enabled                    ║
╚════════════════════════════════════════════╝
      `);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();
