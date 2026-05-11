/**
 * Catatan Kontrakan - Main JavaScript
 */

// Global Maintenance Mode Redirect
// if (!window.location.pathname.includes('maintenance.html')) {
//     window.location.href = 'maintenance.html';
// }


// Auto-detect environment: local (XAMPP) vs production (Vercel)
const API_BASE = window.location.hostname === 'localhost' ? '/Kontrakan/api' : '/api';
const IMAGE_BASE = '';

// ==================== Global Fetch Interceptor ====================
// Otomatis inject JWT token ke semua fetch ke /api/*
(function() {
    const _originalFetch = window.fetch.bind(window);
    window.fetch = function(url, options = {}) {
        const urlStr = typeof url === 'string' ? url : url.toString();
        const isApiCall = urlStr.includes('/api/') || urlStr.startsWith('/api');
        if (isApiCall && !urlStr.includes('cloudinary.com')) {
            const token = localStorage.getItem('kontrakan_token');
            if (token) {
                options = { ...options };
                options.headers = {
                    ...(options.headers || {}),
                    'Authorization': `Bearer ${token}`
                };
            }
            // Remove credentials: 'include' (tidak dipakai dengan JWT)
            delete options.credentials;
        }
        return _originalFetch(url, options);
    };
})();


// Helper to get image URL (Cloudinary or local)
function imageUrl(path) {
    if (!path) return '';
    // If already a full URL (Cloudinary), return as is
    if (path.startsWith('http')) return path;
    // Legacy local path fallback
    let cleanPath = path.startsWith('/') ? path.substring(1) : path;
    return '/' + cleanPath;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

function safeJsonForAttr(value) {
    return JSON.stringify(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
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

// ==================== API Cache (sessionStorage) ====================
// sessionStorage bertahan antar navigasi halaman dalam 1 tab
const _cacheTTL = {
  'users':         5 * 60 * 1000,  // 5 menit
  'balance':       45 * 1000,
  'expenses':      45 * 1000,
  'info':          60 * 1000,
  'notifications': 20 * 1000,
  'settlements':   45 * 1000,
  'payment_info':  60 * 1000,
};

function _getCacheKey(url) { return 'apic__' + url; }
function _getEndpoint(url) { return (url.split('/api/').pop() || '').split('?')[0]; }

function _getCache(url) {
    try {
        const raw = sessionStorage.getItem(_getCacheKey(url));
        if (!raw) return null;
        const { data, ts, ttl } = JSON.parse(raw);
        if (Date.now() - ts > ttl) { sessionStorage.removeItem(_getCacheKey(url)); return null; }
        return data;
    } catch { return null; }
}

function _setCache(url, data) {
    try {
        const endpoint = _getEndpoint(url);
        const ttl = _cacheTTL[endpoint] || 30 * 1000;
        sessionStorage.setItem(_getCacheKey(url), JSON.stringify({ data, ts: Date.now(), ttl }));
    } catch {} // sessionStorage bisa penuh, ignore error
}

function _invalidateCache(endpoints = []) {
    const keys = Object.keys(_cacheTTL);
    const targets = endpoints.length ? endpoints : keys;
    targets.forEach(ep => {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const k = sessionStorage.key(i);
            if (k && k.startsWith('apic__') && k.includes(ep)) {
                sessionStorage.removeItem(k);
            }
        }
    });
}

// ==================== API Helpers ====================
async function api(endpoint, options = {}) {
    const url = `${API_BASE}/${endpoint}`;
    const method = (options.method || 'GET').toUpperCase();

    // Serve GET requests from cache
    if (method === 'GET') {
        const cached = _getCache(url);
        if (cached) return cached;
    }

    const token = localStorage.getItem('kontrakan_token');
    const config = {
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        ...options
    };

    try {
        const response = await fetch(url, config);

        if (response.status === 401) {
            localStorage.removeItem('kontrakan_token');
            localStorage.removeItem('kontrakan_user');
            if (!window.location.pathname.includes('login')) {
                window.location.href = 'login.html';
            }
            return null;
        }

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Request failed');

        // Cache successful GET responses
        if (method === 'GET') _setCache(url, data);

        // Invalidate related caches on mutations
        if (['POST','PUT','DELETE'].includes(method)) {
            const ep = _getEndpoint(url);
            if (ep === 'expenses')     _invalidateCache(['expenses', 'balance']);
            else if (ep === 'settlements') _invalidateCache(['settlements', 'balance']);
            else if (ep === 'info')    _invalidateCache(['info']);
            else if (ep === 'users')   _invalidateCache(['users']);
            else if (ep === 'notifications') _invalidateCache(['notifications']);
            else _invalidateCache([ep]);
        }

        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

async function apiGet(endpoint) { return api(endpoint); }
async function apiPost(endpoint, body) { return api(endpoint, { method: 'POST', body: JSON.stringify(body) }); }
async function apiPut(endpoint, body) { return api(endpoint, { method: 'PUT', body: JSON.stringify(body) }); }
async function apiDelete(endpoint) { return api(endpoint, { method: 'DELETE' }); }


// ==================== Auth ====================
async function checkAuth() {
    try {
        // Cek token di localStorage dulu
        const token = localStorage.getItem('kontrakan_token');
        const savedUser = localStorage.getItem('kontrakan_user');
        if (!token) return false;
        // Parse user dari localStorage
        if (savedUser) {
            state.user = JSON.parse(savedUser);
            if (state.user.must_change_password) {
                setTimeout(() => showToast('Password sementara terdeteksi. Ganti password dulu di halaman profil.', 'info'), 300);
            }
            setTimeout(() => { if (typeof syncPushSubscription === 'function') syncPushSubscription(); }, 0);
            return true;
        }
        // Fallback: verifikasi ke server
        const data = await apiGet('auth?action=me');
        if (data && data.user) {
            state.user = data.user;
            localStorage.setItem('kontrakan_user', JSON.stringify(data.user));
            if (state.user.must_change_password) {
                setTimeout(() => showToast('Password sementara terdeteksi. Ganti password dulu di halaman profil.', 'info'), 300);
            }
            setTimeout(() => { if (typeof syncPushSubscription === 'function') syncPushSubscription(); }, 0);
            return true;
        }
        return false;
    } catch {
        state.user = null;
        return false;
    }
}

async function login(username, password) {
    const response = await fetch(`${API_BASE}/auth?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Login gagal');
    // Simpan token & user ke localStorage
    localStorage.setItem('kontrakan_token', data.token);
    localStorage.setItem('kontrakan_user', JSON.stringify(data.user));
    state.user = data.user;
    if (state.user.must_change_password) {
        setTimeout(() => showToast('Password sementara terdeteksi. Ganti password dulu di halaman profil.', 'info'), 300);
    }
    setTimeout(() => { if (typeof syncPushSubscription === 'function') syncPushSubscription(); }, 0);
    return data;
}

async function logout() {
    localStorage.removeItem('kontrakan_token');
    localStorage.removeItem('kontrakan_user');
    state.user = null;
    window.location.href = 'login.html';
}

// ==================== Users ====================
async function loadUsers() {
    const data = await apiGet('users');
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
    const data = await apiGet('notifications');
    state.notifications = data.notifications;
    state.unreadCount = data.unread_count;
    updateNotificationBadge();
    return data;
}

async function markAllRead() {
    await apiPut('notifications?action=read-all', {});
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
    return await apiGet('balance');
}

function getMyBalance(balances) {
    if (!state.user) return null;
    return balances.find(b => b.user_id == state.user.id);
}

// ==================== Expenses ====================
async function loadExpenses(category = null) {
    let endpoint = 'expenses';
    if (category) endpoint += `?category=${encodeURIComponent(category)}`;
    return await apiGet(endpoint);
}

async function createExpense(data) {
    return await apiPost('expenses', data);
}

async function deleteExpense(id) {
    return await apiDelete(`expenses?id=${id}`);
}

// ==================== Settlements ====================
async function loadSettlements() {
    return await apiGet('settlements');
}

async function createSettlement(toUser, amount) {
    return await apiPost('settlements', { to_user: toUser, amount });
}

// ==================== Upload ====================
// Upload ke Cloudinary langsung dari browser (unsigned preset)
async function uploadReceipt(file) {
    const cloudName = window.CLOUDINARY_CLOUD_NAME;
    const uploadPreset = window.CLOUDINARY_UPLOAD_PRESET;

    if (!cloudName) throw new Error('Cloudinary belum dikonfigurasi');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);
    formData.append('folder', 'kontrakan/receipts');

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: 'POST',
        body: formData
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Upload failed');

    return { success: true, url: data.secure_url, path: data.secure_url };
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


// ==================== Background Prefetch ====================
// Prefetch common API data so next pages load from cache
function prefetchCommonData() {
    // Fire and forget — fill cache for next navigation
    setTimeout(() => {
        apiGet('balance').catch(() => {});
        apiGet('expenses').catch(() => {});
        apiGet('settlements').catch(() => {});
    }, 1500); // Wait 1.5s after page load so we don't compete with critical requests
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

// ==================== Push Notifications ====================
let pushPublicKeyPromise = null;

function isIosDevice() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalonePwa() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

async function getPushPublicKey() {
    if (!pushPublicKeyPromise) {
        pushPublicKeyPromise = fetch(`${API_BASE}/push`)
            .then(async (res) => {
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.publicKey) {
                    throw new Error(data.error || 'Public key push tidak tersedia');
                }
                return data.publicKey;
            })
            .catch((err) => {
                pushPublicKeyPromise = null;
                throw err;
            });
    }
    return pushPublicKeyPromise;
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

async function updatePushUi() {
    const btn = document.getElementById('enablePushBtn');
    const status = document.getElementById('pushStatus');

    if (!btn && !status) return;

    let active = false;
    try {
        if ('serviceWorker' in navigator && 'PushManager' in window) {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription();
            active = Notification.permission === 'granted' && !!subscription;
        }
    } catch (err) {
        console.warn('Failed to update push UI:', err);
    }

    if (btn) btn.classList.toggle('hidden', active);
    if (status) status.classList.toggle('hidden', !active);
}

async function unsubscribeFromPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return true;

    const endpoint = subscription.endpoint;
    try {
        await fetch(`${API_BASE}/push`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint })
        });
    } catch (err) {
        console.warn('Failed to unregister push subscription on server:', err);
    }

    await subscription.unsubscribe();
    await updatePushUi();
    return true;
}

async function subscribeToPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        showToast('Browser ini belum mendukung notifikasi push.', 'error');
        return false;
    }

    if (isIosDevice() && !isStandalonePwa()) {
        showToast('Di iPhone, buka dari Home Screen dulu lalu aktifkan notif.', 'info');
        return false;
    }

    try {
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
            const publicKey = await getPushPublicKey();
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey)
            });
        }

        await apiPost('push', { subscription });
        await updatePushUi();
        showToast('Notifikasi HP berhasil diaktifkan.', 'success');
        return true;
    } catch (err) {
        console.error('Failed to subscribe to push:', err);
        showToast('Gagal mengaktifkan notif HP. Coba refresh lalu ulangi.', 'error');
        return false;
    }
}

async function syncPushSubscription() {
    if (!state.user || !('Notification' in window)) return false;
    if (Notification.permission !== 'granted') {
        await updatePushUi();
        return false;
    }
    return subscribeToPush();
}


async function sendTestPushNotification() {
    try {
        const res = await fetch(`${API_BASE}/test-push`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || 'Gagal kirim tes notifikasi');
        }
        showToast('Tes notifikasi dikirim. Cek HP kamu sekarang.', 'success');
        return true;
    } catch (err) {
        console.error('Failed to send test push:', err);
        showToast('Tes notif gagal dikirim.', 'error');
        return false;
    }
}

async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        showToast('Browser ini belum mendukung notifikasi.', 'error');
        return false;
    }

    if (isIosDevice() && !isStandalonePwa()) {
        showToast('iPhone hanya bisa menerima push jika app dibuka dari Home Screen.', 'info');
        return false;
    }

    if (Notification.permission === 'granted') {
        return syncPushSubscription();
    }

    if (Notification.permission === 'denied') {
        showToast('Notif sedang diblokir. Aktifkan lagi dari pengaturan browser.', 'error');
        return false;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
        return syncPushSubscription();
    }

    showToast('Izin notifikasi belum diberikan.', 'info');
    await updatePushUi();
    return false;
}

document.addEventListener('DOMContentLoaded', () => {
    updatePushUi();

    const testPushBtn = document.getElementById('testPushBtn');
    if (testPushBtn) {
        testPushBtn.addEventListener('click', async () => {
            await sendTestPushNotification();
        });
    }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
            .then(() => updatePushUi())
            .catch(() => {});
    }

    if (state.user && 'Notification' in window && Notification.permission === 'granted') {
        syncPushSubscription();
    }
});

window.escapeHtml = escapeHtml;
window.escapeAttribute = escapeAttribute;
window.safeJsonForAttr = safeJsonForAttr;
