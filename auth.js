const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { findUserByApiKey, findUserByEmail, findUserById, updateLoginInfo } = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'fb-downloader-pro-secret-key-2026';
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';

// Token blacklist (in-memory)
const tokenBlacklist = new Set();

// Generate JWT token
function generateToken(user) {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email, 
      username: user.username,
      is_premium: user.is_premium,
      is_admin: user.is_admin 
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRE }
  );
}

// Verify JWT token
function verifyToken(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ 
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }
  
  // Check if token is blacklisted
  if (tokenBlacklist.has(token)) {
    return res.status(401).json({ 
      success: false,
      error: 'Token has been revoked',
      code: 'TOKEN_REVOKED'
    });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    req.token = token;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false,
        error: 'Token has expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    return res.status(401).json({ 
      success: false,
      error: 'Invalid token',
      code: 'INVALID_TOKEN'
    });
  }
}

// Revoke token
function revokeToken(token) {
  tokenBlacklist.add(token);
  setTimeout(() => {
    tokenBlacklist.delete(token);
  }, 7 * 24 * 60 * 60 * 1000);
}

// API Key authentication
async function verifyApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ 
      success: false,
      error: 'API key required',
      code: 'API_KEY_REQUIRED'
    });
  }
  
  try {
    const user = await findUserByApiKey(apiKey);
    if (!user) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid API key',
        code: 'INVALID_API_KEY'
      });
    }
    
    if (!user.is_active || user.is_banned) {
      return res.status(403).json({ 
        success: false,
        error: 'Account is inactive or banned',
        code: 'ACCOUNT_BANNED'
      });
    }
    
    req.user = user;
    req.apiKey = apiKey;
    next();
  } catch (error) {
    return res.status(500).json({ 
      success: false,
      error: 'Authentication error',
      code: 'AUTH_ERROR'
    });
  }
}

// Optional authentication
async function optionalAuth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  const apiKey = req.headers['x-api-key'];
  
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
    } catch (error) {
      // Ignore invalid token
    }
  } else if (apiKey) {
    try {
      const user = await findUserByApiKey(apiKey);
      if (user) {
        req.user = user;
      }
    } catch (error) {
      // Ignore invalid API key
    }
  }
  
  next();
}

// Admin check
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ 
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }
  
  if (!req.user.is_admin) {
    return res.status(403).json({ 
      success: false,
      error: 'Admin access required',
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
      error: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }
  
  if (!req.user.is_premium) {
    return res.status(403).json({ 
      success: false,
      error: 'Premium membership required',
      code: 'PREMIUM_REQUIRED'
    });
  }
  
  next();
}

// Password hashing
async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Generate API key
function generateApiKey() {
  return 'fb_' + uuidv4().replace(/-/g, '').slice(0, 30);
}

module.exports = {
  generateToken,
  verifyToken,
  revokeToken,
  verifyApiKey,
  optionalAuth,
  requireAdmin,
  requirePremium,
  hashPassword,
  comparePassword,
  generateApiKey,
  JWT_SECRET
};