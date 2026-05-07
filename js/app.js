/**
 * Catatan Kontrakan - Main JavaScript
 */

// Auto-detect environment: local (XAMPP) vs production (Railway)
const API_BASE = window.location.hostname === 'localhost' ? '/Kontrakan/api' : '/api';
const IMAGE_BASE = window.location.hostname === 'localhost' ? '/Kontrakan' : '';

// Helper to get image URL
function imageUrl(path) {
    if (!path) return '';
    // Remove leading slash if present
    let cleanPath = path.startsWith('/') ? path.substring(1) : path;
    // If path doesn't start with uploads, add it
    if (!cleanPath.startsWith('uploads/') && !cleanPath.startsWith('http')) {
        cleanPath = 'uploads/' + cleanPath;
    }
    return IMAGE_BASE + '/' + cleanPath;
}

// ==================== State ====================
const state = {
    user: null,
    users: [],
    notifications: [],
    unreadCount: 0
};

// ==================== Theme ====================
function initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved) {
        document.documentElement.setAttribute('data-theme', saved);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
    updateThemeIcons();
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcons();
}

function getTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
}

function updateThemeIcons() {
    const isDark = getTheme() === 'dark';
    document.querySelectorAll('.theme-toggle-icon').forEach(el => {
        el.innerHTML = isDark ? icons.sun : icons.moon;
    });
}

// ==================== API Helpers ====================
async function api(endpoint, options = {}) {
    const url = `${API_BASE}/${endpoint}`;
    const config = {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        ...options
    };

    try {
        const response = await fetch(url, config);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Request failed');
        }

        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

async function apiGet(endpoint) {
    return api(endpoint);
}

async function apiPost(endpoint, body) {
    return api(endpoint, { method: 'POST', body: JSON.stringify(body) });
}

async function apiPut(endpoint, body) {
    return api(endpoint, { method: 'PUT', body: JSON.stringify(body) });
}

async function apiDelete(endpoint) {
    return api(endpoint, { method: 'DELETE' });
}

// ==================== Auth ====================
async function checkAuth() {
    try {
        const data = await apiGet('auth.php?action=me');
        state.user = data.user;
        return true;
    } catch {
        state.user = null;
        return false;
    }
}

async function login(username, password) {
    const data = await apiPost('auth.php?action=login', { username, password });
    state.user = data.user;
    return data;
}

async function logout() {
    await apiPost('auth.php?action=logout', {});
    state.user = null;
    window.location.href = 'login.html';
}

// ==================== Users ====================
async function loadUsers() {
    const data = await apiGet('users.php');
    state.users = data.users;
    return data.users;
}

function getUserById(id) {
    return state.users.find(u => u.id == id);
}

function getUserInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

// ==================== Notifications ====================
async function loadNotifications() {
    const data = await apiGet('notifications.php');
    state.notifications = data.notifications;
    state.unreadCount = data.unread_count;
    updateNotificationBadge();
    return data;
}

async function markAllRead() {
    await apiPut('notifications.php?action=read-all', {});
    state.unreadCount = 0;
    updateNotificationBadge();
}

function updateNotificationBadge() {
    document.querySelectorAll('.nav-badge').forEach(badge => {
        if (state.unreadCount > 0) {
            badge.textContent = state.unreadCount > 9 ? '9+' : state.unreadCount;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    });
}

// ==================== Balance ====================
async function loadBalance() {
    return await apiGet('balance.php');
}

function getMyBalance(balances) {
    if (!state.user) return null;
    return balances.find(b => b.user_id == state.user.id);
}

// ==================== Expenses ====================
async function loadExpenses(category = null) {
    let endpoint = 'expenses.php';
    if (category) endpoint += `?category=${encodeURIComponent(category)}`;
    return await apiGet(endpoint);
}

async function createExpense(data) {
    return await apiPost('expenses.php', data);
}

async function deleteExpense(id) {
    return await apiDelete(`expenses.php?id=${id}`);
}

// ==================== Settlements ====================
async function loadSettlements() {
    return await apiGet('settlements.php');
}

async function createSettlement(toUser, amount) {
    return await apiPost('settlements.php', { to_user: toUser, amount });
}

// ==================== Upload ====================
async function uploadReceipt(file) {
    const formData = new FormData();
    formData.append('receipt', file);

    const response = await fetch(`${API_BASE}/upload.php`, {
        method: 'POST',
        credentials: 'include',
        body: formData
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Upload failed');

    return data;
}

// ==================== UI Helpers ====================
function formatCurrency(amount) {
    const num = parseFloat(amount);
    const prefix = num >= 0 ? '+' : '';
    return prefix + 'Rp ' + Math.abs(num).toLocaleString('id-ID');
}

function formatCurrencyPlain(amount) {
    return 'Rp ' + parseFloat(amount).toLocaleString('id-ID');
}

function formatCurrencyShort(amount) {
    const num = parseFloat(amount);
    if (num >= 1000000) {
        return 'Rp ' + (num / 1000000).toFixed(1) + 'jt';
    }
    if (num >= 1000) {
        return 'Rp ' + (num / 1000).toFixed(0) + 'rb';
    }
    return 'Rp ' + num.toLocaleString('id-ID');
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'Baru saja';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m lalu`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}j lalu`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}h lalu`;

    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

// ==================== Toast ====================
function showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}

// ==================== Loading ====================
function showLoading() {
    let overlay = document.querySelector('.loading-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.innerHTML = '<div class="spinner"></div>';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;z-index:5000;';
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
}

function hideLoading() {
    const overlay = document.querySelector('.loading-overlay');
    if (overlay) overlay.style.display = 'none';
}

// ==================== Modal ====================
let scrollPosition = 0;
let modalDragData = null;

function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        // Save scroll position and lock body
        scrollPosition = window.pageYOffset;
        document.body.classList.add('modal-open');
        document.body.style.top = `-${scrollPosition}px`;
        modal.classList.add('active');

        // Setup swipe-to-close
        setupModalSwipe(modal);
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.remove('active');
        // Reset any transform from dragging
        const modalContent = modal.querySelector('.modal');
        if (modalContent) {
            modalContent.style.transform = '';
            modalContent.style.transition = '';
        }
        // Restore scroll position and unlock body
        document.body.classList.remove('modal-open');
        document.body.style.top = '';
        window.scrollTo(0, scrollPosition);
    }
}

// Swipe-to-close functionality
function setupModalSwipe(overlay) {
    const modal = overlay.querySelector('.modal');
    if (!modal) return;

    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    const handleTouchStart = (e) => {
        // Only start drag from top area (handle or at scroll top)
        const scrollTop = modal.scrollTop;
        if (scrollTop > 5) return; // Don't drag if scrolled down

        startY = e.touches[0].clientY;
        isDragging = true;
        modal.style.transition = 'none';
    };

    const handleTouchMove = (e) => {
        if (!isDragging) return;

        currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;

        // Only allow dragging down
        if (deltaY > 0) {
            // Apply resistance effect
            const resistance = 0.6;
            const translateY = deltaY * resistance;
            modal.style.transform = `translateY(${translateY}px)`;

            // Change opacity based on drag distance
            const opacity = Math.max(0.3, 1 - (deltaY / 400));
            overlay.style.backgroundColor = `rgba(0, 0, 0, ${opacity * 0.8})`;

            // Prevent scroll while dragging
            e.preventDefault();
        }
    };

    const handleTouchEnd = () => {
        if (!isDragging) return;
        isDragging = false;

        const deltaY = currentY - startY;
        const threshold = 100; // Minimum distance to close

        modal.style.transition = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)';
        overlay.style.transition = 'background-color 0.3s ease';

        if (deltaY > threshold) {
            // Close modal
            modal.style.transform = 'translateY(100%)';
            overlay.style.backgroundColor = 'transparent';
            setTimeout(() => {
                closeModal(overlay.id);
            }, 300);
        } else {
            // Snap back
            modal.style.transform = 'translateY(0)';
            overlay.style.backgroundColor = '';
        }

        startY = 0;
        currentY = 0;
    };

    // Remove old listeners if any
    modal.removeEventListener('touchstart', modal._touchStartHandler);
    modal.removeEventListener('touchmove', modal._touchMoveHandler);
    modal.removeEventListener('touchend', modal._touchEndHandler);

    // Store handlers for cleanup
    modal._touchStartHandler = handleTouchStart;
    modal._touchMoveHandler = handleTouchMove;
    modal._touchEndHandler = handleTouchEnd;

    // Add listeners
    modal.addEventListener('touchstart', handleTouchStart, { passive: true });
    modal.addEventListener('touchmove', handleTouchMove, { passive: false });
    modal.addEventListener('touchend', handleTouchEnd, { passive: true });
}

// ==================== Navigation ====================
function updateActiveNav() {
    const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
    document.querySelectorAll('.nav-item').forEach(item => {
        const href = item.getAttribute('href');
        item.classList.toggle('active', href === currentPage);
    });
}

// ==================== PWA ====================
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

function installPWA() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choice) => {
            if (choice.outcome === 'accepted') {
                showToast('App berhasil diinstall!', 'success');
            }
            deferredPrompt = null;
        });
    }
}

// ==================== Init ====================
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    updateActiveNav();

    if ('serviceWorker' in navigator) {
        const swPath = window.location.hostname === 'localhost' ? '/Kontrakan/sw.js' : '/sw.js';
        navigator.serviceWorker.register(swPath)
            .then(() => console.log('SW registered'))
            .catch(err => console.error('SW failed:', err));
    }
});
