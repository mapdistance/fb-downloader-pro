// ===== API Configuration =====
const API_BASE_URL = window.location.origin;
const TOKEN_KEY = 'fb_downloader_token';
const USER_KEY = 'fb_downloader_user';

// ===== Utility Functions =====
function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}

function removeToken() {
    localStorage.removeItem(TOKEN_KEY);
}

function getUser() {
    const userStr = localStorage.getItem(USER_KEY);
    return userStr ? JSON.parse(userStr) : null;
}

function setUser(user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function removeUser() {
    localStorage.removeItem(USER_KEY);
}

function isLoggedIn() {
    return !!getToken();
}

// ===== Toast Notification =====
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
        <span>${message}</span>
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ===== Clipboard Functions =====
async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        document.getElementById('videoUrl').value = text;
        showToast('URL pasted successfully!');
    } catch (error) {
        showToast('Failed to paste from clipboard', 'error');
    }
}

// ===== Download Functions =====
async function downloadVideo() {
    const url = document.getElementById('videoUrl').value.trim();
    const format = document.getElementById('formatSelect').value;
    const quality = document.getElementById('qualitySelect').value;
    
    if (!url) {
        showToast('Please enter a video URL', 'error');
        return;
    }
    
    // Validate URL
    if (!url.includes('facebook.com') && !url.includes('fb.watch') && !url.includes('instagram.com')) {
        showToast('Please enter a valid Facebook URL', 'error');
        return;
    }
    
    // Show loading
    document.getElementById('loadingSpinner').style.display = 'block';
    document.getElementById('resultBox').style.display = 'none';
    
    try {
        let endpoint = '/api/download-video';
        let body = { url, quality };
        
        if (format === 'audio') {
            endpoint = '/api/convert-audio';
            body = { url, quality: '128', format: 'mp3' };
        } else if (format === 'thumbnail') {
            endpoint = '/api/download-thumbnail';
            body = { url };
        }
        
        const headers = { 'Content-Type': 'application/json' };
        if (isLoggedIn()) {
            headers['Authorization'] = `Bearer ${getToken()}`;
        }
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Show result
            document.getElementById('loadingSpinner').style.display = 'none';
            document.getElementById('resultBox').style.display = 'block';
            
            const downloadLink = document.getElementById('downloadLink');
            downloadLink.href = data.downloadUrl;
            
            const videoInfo = document.getElementById('videoInfo');
            videoInfo.innerHTML = `
                <p><strong>File:</strong> ${data.fileName || 'Download'}</p>
                ${data.fileSize ? `<p><strong>Size:</strong> ${data.fileSize}</p>` : ''}
            `;
            
            showToast('Download ready!');
        } else {
            throw new Error(data.error || 'Download failed');
        }
    } catch (error) {
        document.getElementById('loadingSpinner').style.display = 'none';
        showToast(error.message || 'Download failed', 'error');
    }
}

// ===== Auth Functions =====
function showLoginModal() {
    document.getElementById('loginModal').style.display = 'flex';
}

function closeLoginModal() {
    document.getElementById('loginModal').style.display = 'none';
}

function showRegisterModal() {
    document.getElementById('registerModal').style.display = 'flex';
}

function closeRegisterModal() {
    document.getElementById('registerModal').style.display = 'none';
}

function showRegister() {
    closeLoginModal();
    showRegisterModal();
}

function showLogin() {
    closeRegisterModal();
    showLoginModal();
}

async function login(event) {
    event.preventDefault();
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            setToken(data.token);
            setUser(data.user);
            closeLoginModal();
            showToast('Login successful!');
            
            // Redirect to dashboard after 1 second
            setTimeout(() => {
                window.location.href = '/dashboard.html';
            }, 1000);
        } else {
            showToast(data.error || 'Login failed', 'error');
        }
    } catch (error) {
        showToast('Login failed', 'error');
    }
}

async function register(event) {
    event.preventDefault();
    
    const username = document.getElementById('regUsername').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            setToken(data.token);
            setUser(data.user);
            closeRegisterModal();
            showToast('Registration successful!');
            
            setTimeout(() => {
                window.location.href = '/dashboard.html';
            }, 1000);
        } else {
            showToast(data.error || 'Registration failed', 'error');
        }
    } catch (error) {
        showToast('Registration failed', 'error');
    }
}

// ===== Mobile Menu =====
function toggleMobileMenu() {
    const menu = document.querySelector('.nav-menu');
    menu.classList.toggle('active');
}

// ===== FAQ Toggle =====
function toggleFAQ(button) {
    const answer = button.nextElementSibling;
    const icon = button.querySelector('i');
    
    answer.classList.toggle('active');
    icon.classList.toggle('fa-chevron-up');
    icon.classList.toggle('fa-chevron-down');
}

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', (e) => {
    // Ctrl+V to paste
    if (e.ctrlKey && e.key === 'v') {
        // Auto-paste from clipboard
        pasteFromClipboard();
    }
    
    // Enter to download
    if (e.key === 'Enter' && document.activeElement === document.getElementById('videoUrl')) {
        downloadVideo();
    }
});

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', () => {
    console.log('FB Downloader Pro initialized');
    
    // Check if logged in
    if (isLoggedIn()) {
        const user = getUser();
        if (user) {
            console.log('Logged in as:', user.username);
            // Update UI for logged in user
            const navActions = document.querySelector('.nav-actions');
            if (navActions) {
                navActions.innerHTML = `
                    <a href="/dashboard.html" class="btn btn-outline">
                        <i class="fas fa-user"></i> ${user.username}
                    </a>
                    <button class="btn btn-primary" onclick="logout()">Logout</button>
                `;
            }
        }
    }
});

// Logout function
function logout() {
    removeToken();
    removeUser();
    showToast('Logged out successfully');
    setTimeout(() => {
        window.location.reload();
    }, 1000);
}
