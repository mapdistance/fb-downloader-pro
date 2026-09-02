const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { findUserByApiKey, findUserById, findUserByEmail } = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'fb-downloader-pro-secret-key-2026-change-this';
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'fb-downloader-pro-refresh-secret-2026';
const JWT_REFRESH_EXPIRE = process.env.JWT_REFRESH_EXPIRE || '30d';

// Token blacklist (in-memory storage)
const tokenBlacklist = new Set();

// ==================== TOKEN FUNCTIONS ====================

// Generate JWT access token
function generateToken(user) {
  const payload = {
    id: user.id,
    email: user.email,
    username: user.username,
    is_premium: user.is_premium || 0,
    is_admin: user.is_admin || 0,
    premium_plan: user.premium_plan || null
  };
  
  return jwt.sign(payload, JWT_SECRET, { 
    expiresIn: JWT_EXPIRE,
    issuer: 'fb-downloader-pro',
    audience: 'fb-downloader-users'
  });
}

// Generate refresh token
function generateRefreshToken(user) {
  const payload = {
    id: user.id,
    type: 'refresh'
  };
  
  return jwt.sign(payload, JWT_REFRESH_SECRET, { 
    expiresIn: JWT_REFRESH_EXPIRE,
    issuer: 'fb-downloader-pro',
    audience: 'fb-downloader-users'
  });
}

// Verify JWT token
function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader ? authHeader.replace('Bearer ', '') : null;
    
    if (!token) {
      return res.status(401).json({ 
        success: false,
        error: 'Authentication required. Please provide a valid token.',
        code: 'AUTH_REQUIRED'
      });
    }
    
    // Check if token is blacklisted
    if (tokenBlacklist.has(token)) {
      return res.status(401).json({ 
        success: false,
        error: 'Token has been revoked. Please login again.',
        code: 'TOKEN_REVOKED'
      });
    }
    
    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'fb-downloader-pro',
      audience: 'fb-downloader-users'
    });
    
    // Attach user info to request
    req.user = decoded;
    req.token = token;
    
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false,
        error: 'Token has expired. Please login again.',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid token format.',
        code: 'INVALID_TOKEN'
      });
    }
    
    return res.status(401).json({ 
      success: false,
      error: 'Authentication failed.',
      code: 'AUTH_FAILED'
    });
  }
}

// Verify refresh token
function verifyRefreshToken(token) {
  return new Promise((resolve, reject) => {
    try {
      const decoded = jwt.verify(token, JWT_REFRESH_SECRET, {
        issuer: 'fb-downloader-pro',
        audience: 'fb-downloader-users'
      });
      resolve(decoded);
    } catch (error) {
      reject(error);
    }
  });
}

// Refresh access token
async function refreshAccessToken(req, res) {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({ 
        success: false,
        error: 'Refresh token is required.',
        code: 'REFRESH_REQUIRED'
      });
    }
    
    // Verify refresh token
    const decoded = await verifyRefreshToken(refreshToken);
    
    // Get user from database
    const user = findUserById(decoded.id);
    
    if (!user) {
      return res.status(401).json({ 
        success: false,
        error: 'User not found.',
        code: 'USER_NOT_FOUND'
      });
    }
    
    if (!user.is_active || user.is_banned) {
      return res.status(403).json({ 
        success: false,
        error: 'Account is inactive or banned.',
        code: 'ACCOUNT_BANNED'
      });
    }
    
    // Generate new tokens
    const newToken = generateToken(user);
    const newRefreshToken = generateRefreshToken(user);
    
    res.json({
      success: true,
      token: newToken,
      refreshToken: newRefreshToken
    });
  } catch (error) {
    return res.status(401).json({ 
      success: false,
      error: 'Invalid or expired refresh token.',
      code: 'INVALID_REFRESH'
    });
  }
}

// Revoke token (logout)
function revokeToken(token) {
  tokenBlacklist.add(token);
  
  // Auto-remove from blacklist after 7 days (token expiry)
  setTimeout(() => {
    tokenBlacklist.delete(token);
  }, 7 * 24 * 60 * 60 * 1000);
  
  return true;
}

// ==================== API KEY AUTHENTICATION ====================

// Verify API key
function verifyApiKey(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    
    if (!apiKey) {
      return res.status(401).json({ 
        success: false,
        error: 'API key is required. Please provide a valid API key.',
        code: 'API_KEY_REQUIRED'
      });
    }
    
    // Find user by API key
    const user = findUserByApiKey(apiKey);
    
    if (!user) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid API key.',
        code: 'INVALID_API_KEY'
      });
    }
    
    if (!user.is_active) {
      return res.status(403).json({ 
        success: false,
        error: 'Account is inactive.',
        code: 'ACCOUNT_INACTIVE'
      });
    }
    
    if (user.is_banned) {
      return res.status(403).json({ 
        success: false,
        error: 'Account is banned.',
        code: 'ACCOUNT_BANNED'
      });
    }
    
    // Attach user info to request
    req.user = user;
    req.apiKey = apiKey;
    
    next();
  } catch (error) {
    return res.status(500).json({ 
      success: false,
      error: 'Authentication error.',
      code: 'AUTH_ERROR'
    });
  }
}

// Optional authentication (works with or without auth)
function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader ? authHeader.replace('Bearer ', '') : null;
    const apiKey = req.headers['x-api-key'];
    
    // Try JWT token first
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET, {
          issuer: 'fb-downloader-pro',
          audience: 'fb-downloader-users'
        });
        
        // Check if token is not blacklisted
        if (!tokenBlacklist.has(token)) {
          req.user = decoded;
          req.token = token;
        }
      } catch (error) {
        // Invalid token - continue without auth
      }
    } 
    // Try API key if no valid token
    else if (apiKey) {
      const user = findUserByApiKey(apiKey);
      if (user && user.is_active && !user.is_banned) {
        req.user = user;
        req.apiKey = apiKey;
      }
    }
    
    next();
  } catch (error) {
    // Continue without auth on error
    next();
  }
}

// ==================== ROLE CHECKS ====================

// Admin check
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ 
      success: false,
      error: 'Authentication required.',
      code: 'AUTH_REQUIRED'
    });
  }
  
  if (!req.user.is_admin) {
    return res.status(403).json({ 
      success: false,
      error: 'Admin access required.',
      code: 'ADMIN_REQUIRED'
    });
  }
  
  next();
}

// Premium check
function requirePremium(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ 
      success: false,
      error: 'Authentication required.',
      code: 'AUTH_REQUIRED'
    });
  }
  
  if (!req.user.is_premium) {
    return res.status(403).json({ 
      success: false,
      error: 'Premium membership required.',
      code: 'PREMIUM_REQUIRED',
      upgrade_url: '/api/premium/upgrade'
    });
  }
  
  next();
}

// ==================== PASSWORD FUNCTIONS ====================

// Hash password
async function hashPassword(password) {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
}

// Compare password
async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Validate password strength
function validatePassword(password) {
  const checks = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    numbers: /[0-9]/.test(password),
    special: /[!@#$%^&*(),.?":{}|<>]/.test(password)
  };
  
  const score = Object.values(checks).filter(Boolean).length;
  
  return {
    valid: checks.length && checks.uppercase && checks.lowercase && checks.numbers,
    score: score, // 0-5
    strength: score <= 2 ? 'weak' : score <= 3 ? 'medium' : score <= 4 ? 'strong' : 'very_strong',
    checks
  };
}

// ==================== API KEY FUNCTIONS ====================

// Generate new API key
function generateApiKey() {
  return 'fb_' + uuidv4().replace(/-/g, '').slice(0, 30) + '_' + Date.now().toString(36);
}

// ==================== SESSION FUNCTIONS ====================

// Create session data
function createSession(user) {
  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      is_premium: user.is_premium || 0,
      is_admin: user.is_admin || 0
    },
    createdAt: new Date().toISOString()
  };
}

// ==================== EXPORT ALL FUNCTIONS ====================

module.exports = {
  // Token functions
  generateToken,
  generateRefreshToken,
  verifyToken,
  verifyRefreshToken,
  refreshAccessToken,
  revokeToken,
  
  // Authentication middleware
  verifyApiKey,
  optionalAuth,
  
  // Role checks
  requireAdmin,
  requirePremium,
  
  // Password functions
  hashPassword,
  comparePassword,
  validatePassword,
  
  // API key functions
  generateApiKey,
  
  // Session functions
  createSession,
  
  // Constants
  JWT_SECRET,
  JWT_REFRESH_SECRET
};
