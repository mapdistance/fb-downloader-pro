const API_BASE_URL = window.location.origin;
const TOKEN_KEY = 'fb_downloader_token';
const USER_KEY = 'fb_downloader_user';

// Check authentication
if (!localStorage.getItem(TOKEN_KEY)) {
    window.location.href = '/';
}

// Get user info
const user = JSON.parse(localStorage.getItem(USER_KEY));

// Display user info
document.getElementById('userName').textContent = user.username;

// Show section
function showSection(sectionName) {
    // Hide all sections
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Show selected section
    document.getElementById(sectionName).classList.add('active');
    
    // Update title
    const titles = {
        overview: 'Overview',
        history: 'Download History',
        api: 'API Keys',
        profile: 'Profile Settings',
        premium: 'Premium Plans',
        notifications: 'Notifications'
    };
    document.getElementById('sectionTitle').textContent = titles[sectionName] || 'Dashboard';
    
    // Update active link
    document.querySelectorAll('.sidebar-nav a').forEach(link => {
        link.classList.remove('active');
    });
    event.currentTarget.classList.add('active');
    
    // Load data for section
    if (sectionName === 'history') loadHistory();
    if (sectionName === 'api') loadApiKey();
    if (sectionName === 'profile') loadProfile();
    if (sectionName === 'notifications') loadNotifications();
}

// Load user profile
async function loadProfile() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/profile`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem(TOKEN_KEY)}`
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('profileUsername').value = data.user.username;
            document.getElementById('profileEmail').value = data.user.email;
            document.getElementById('apiKey').textContent = data.user.api_key;
        }
    } catch (error) {
        console.error('Failed to load profile:', error);
    }
}

// Load download history
async function loadHistory() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/history`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem(TOKEN_KEY)}`
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            const historyList = document.getElementById('historyList');
            
            if (data.history.length === 0) {
                historyList.innerHTML = '<p>No downloads yet</p>';
                return;
            }
            
            historyList.innerHTML = data.history.map(item => `
                <div class="history-item">
                    <div>
                        <strong>${item.title || 'Untitled'}</strong>
                        <p>${item.type} - ${item.format} - ${item.quality}</p>
                        <small>${new Date(item.downloaded_at).toLocaleDateString()}</small>
                    </div>
                    <span>${item.file_size || ''}</span>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Failed to load history:', error);
    }
}

// Load API key
function loadApiKey() {
    const apiKey = document.getElementById('apiKey');
    apiKey.textContent = user.api_key || 'No API key generated';
}

// Copy API key
function copyApiKey() {
    const apiKey = document.getElementById('apiKey').textContent;
    navigator.clipboard.writeText(apiKey).then(() => {
        alert('API key copied!');
    });
}

// Regenerate API key
async function regenerateApiKey() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/regenerate-api-key`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem(TOKEN_KEY)}`
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('apiKey').textContent = data.api_key;
            alert('API key regenerated!');
        }
    } catch (error) {
        console.error('Failed to regenerate API key:', error);
    }
}

// Update profile
async function updateProfile(event) {
    event.preventDefault();
    
    const username = document.getElementById('profileUsername').value;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/profile`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem(TOKEN_KEY)}`
            },
            body: JSON.stringify({ username })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Profile updated!');
        }
    } catch (error) {
        console.error('Failed to update profile:', error);
    }
}

// Quick download
function quickDownload() {
    const url = document.getElementById('quickUrl').value;
    if (url) {
        window.location.href = `/?url=${encodeURIComponent(url)}`;
    }
}

// Upgrade premium
async function upgradePremium(plan) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/premium/upgrade`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem(TOKEN_KEY)}`
            },
            body: JSON.stringify({ plan })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Premium activated!');
            location.reload();
        }
    } catch (error) {
        console.error('Failed to upgrade:', error);
    }
}

// Load notifications
async function loadNotifications() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/notifications`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem(TOKEN_KEY)}`
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            const notificationList = document.getElementById('notificationList');
            
            if (data.notifications.length === 0) {
                notificationList.innerHTML = '<p>No notifications</p>';
                return;
            }
            
            notificationList.innerHTML = data.notifications.map(notification => `
                <div class="history-item">
                    <div>
                        <strong>${notification.title}</strong>
                        <p>${notification.message}</p>
                        <small>${new Date(notification.created_at).toLocaleDateString()}</small>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Failed to load notifications:', error);
    }
}

// Logout
function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.location.href = '/';
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadProfile();
});
