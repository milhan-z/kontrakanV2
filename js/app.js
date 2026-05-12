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

// ==================== Feature Tour ====================
const FEATURE_TOUR_VERSION = 'v3';
const FEATURE_TOUR_SESSION_KEY = 'kontrakan_feature_tour_resume';
const FEATURE_TOUR_PENDING_ACTION_KEY = 'kontrakan_feature_tour_action';
const FEATURE_MINI_TIP_VERSION = 'v1';
let featureTourIndex = 0;
let featureTourSteps = [];
let featureTourManual = false;
let featureTourLayoutQueued = false;

function getCurrentPageName() {
    return window.location.pathname.split('/').pop() || 'dashboard.html';
}

function getFeatureTourKey() {
    const userId = state.user?.id || state.user?.user_id || 'guest';
    return `kontrakan_feature_tour_${FEATURE_TOUR_VERSION}_${userId}`;
}

function getFeatureTourSteps() {
    const steps = [
        {
            page: 'dashboard.html',
            eyebrow: 'Mulai dari Home',
            title: 'Pantau hutang, piutang, dan kabar kontrakan',
            body: 'Dashboard adalah ringkasan harian: saldo hutang/piutang, info terbaru, tombol tambah transaksi, dan banner jastip yang sedang open.',
            action: 'Area ini jadi titik awal sebelum kamu masuk ke fitur lain.',
            target: ['.greeting', '.page-title'],
            cta: { label: 'Buka Home', url: 'dashboard.html' }
        },
        {
            page: 'add-expense.html',
            eyebrow: 'Tambah Transaksi',
            title: 'Catat patungan dan split bill',
            body: 'Masukkan total belanja, pilih siapa yang bayar, lalu tentukan siapa saja yang ikut. Untuk split bill detail, item bisa dibagi per orang atau per porsi.',
            action: 'Tekan tombol plus untuk mulai catat pengeluaran baru.',
            target: ['.fab', 'a[href="add-expense.html"]'],
            cta: { label: 'Tambah Transaksi', url: 'add-expense.html' }
        },
        {
            page: 'settle.html',
            eyebrow: 'Bayar & Tagih',
            title: 'Selesaikan hutang tanpa hitung manual',
            body: 'Halaman Bayar menampilkan saran pembayaran paling ringkas. Info rekening, e-wallet, dan QRIS diambil dari Profil penerima.',
            action: 'Buka menu Bayar atau tombol Bayar/Tagih di kartu saldo.',
            target: ['.bottom-nav a[href="settle.html"]', '.balance-cards'],
            cta: { label: 'Buka Bayar', url: 'settle.html' }
        },
        {
            page: 'jastip.html',
            eyebrow: 'Jastip Kontrakan',
            title: 'Open jastip dan kumpulkan titipan teman',
            body: 'Saat ada yang open jastip, teman kontrakan dapat notif. Mereka bisa titip beberapa item sekaligus, lalu owner mengisi hasil belanja dan harga.',
            action: 'Buka menu Jastip. Kalau sedang ada yang open, bannernya juga muncul di dashboard.',
            target: ['#activeJastipBanner.show', '.bottom-nav a[href="jastip.html"]', '#openJastipButton'],
            cta: { label: 'Open Jastip', url: 'jastip.html', action: 'open-jastip' }
        },
        {
            page: 'history.html',
            eyebrow: 'Riwayat',
            title: 'Cek transaksi dan jastip dalam satu timeline',
            body: 'Riwayat menyatukan transaksi biasa dan jastip. Pakai filter kategori, pencarian, dan tanggal untuk menemukan catatan lama.',
            action: 'Ketuk kartu riwayat untuk melihat detail split dan item.',
            target: ['.filter-pill-row', '.bottom-nav a[href="history.html"]', '#transactionList'],
            cta: { label: 'Buka Riwayat', url: 'history.html' }
        },
        {
            page: 'profile.html',
            eyebrow: 'Notifikasi HP',
            title: 'Aktifkan push supaya tidak kelewat kabar',
            body: 'Push dipakai untuk jastip baru, tagihan, dan update penting. Di iPhone, buka app dari Home Screen dulu sebelum mengaktifkan notifikasi.',
            action: 'Dari Profil, tekan tombol Aktifkan Notif HP.',
            target: ['#enablePushBtn', 'a[href="notifications.html"]'],
            cta: { label: 'Aktifkan Notif', url: 'profile.html', action: 'enable-push' }
        },
        {
            page: 'profile.html',
            eyebrow: 'Profil',
            title: 'Lengkapi data pembayaranmu',
            body: 'Isi nomor WhatsApp, rekening bank, e-wallet, dan QRIS. Data ini muncul saat teman mau bayar hutang ke kamu.',
            action: 'Nomor WA yang sudah tersimpan sekarang langsung kelihatan di kartu profil.',
            target: ['#phoneWa', '.bottom-nav a[href="profile.html"]'],
            cta: { label: 'Isi Profil', url: 'profile.html', action: 'focus-profile' }
        }
    ];

    if (state.user?.role === 'admin') {
        steps.push({
            page: 'profile.html',
            eyebrow: 'Admin',
            title: 'Kelola user dan data kontrakan',
            body: 'Admin panel dipakai untuk reset password, edit user, cek transaksi, hapus data bermasalah, dan monitoring jastip.',
            action: 'Admin panel muncul di Profil khusus akun admin.',
            target: ['#adminSection a', 'a[href="admin.html"]'],
            cta: { label: 'Buka Admin', url: 'admin.html' }
        });
    }

    return steps;
}

function queueAutoFeatureTour() {
    if (!state.user || state.user.must_change_password) return;
    const page = getCurrentPageName();
    if (!['dashboard.html', ''].includes(page)) return;
    if (localStorage.getItem(getFeatureTourKey()) === 'done') return;
    setTimeout(() => {
        if (state.user && !document.querySelector('.feature-tour-overlay.active')) {
            startFeatureTour({ manual: false });
        }
    }, 1100);
}

function getFeatureMiniTipConfig() {
    const page = getCurrentPageName();
    const tips = {
        'dashboard.html': {
            id: 'dashboard',
            title: 'Tip Home',
            body: 'Kalau ada jastip aktif, banner nempel di bawah. Tap Pantau buat langsung masuk ke list titipan.'
        },
        'add-expense.html': {
            id: 'add-expense',
            title: 'Tip Split Bill',
            body: 'Untuk belanja banyak item, pakai mode detail supaya porsi tiap orang bisa beda.'
        },
        'settle.html': {
            id: 'settle',
            title: 'Tip Bayar',
            body: 'Tap nama teman untuk lihat rincian hutang, rekening, QRIS, dan bukti pembayaran.'
        },
        'jastip.html': {
            id: 'jastip',
            title: 'Tip Jastip',
            body: 'Titip beberapa barang sekaligus dari tombol Titip Barang, jadi tidak perlu bolak-balik.'
        },
        'history.html': {
            id: 'history',
            title: 'Tip Riwayat',
            body: 'Pakai filter Tanggal, Kategori, dan Cari untuk menemukan transaksi lama lebih cepat.'
        },
        'profile.html': {
            id: 'profile',
            title: 'Tip Profil',
            body: 'Lengkapi nomor WA dan metode bayar supaya tombol tagih teman langsung siap dipakai.'
        }
    };
    return tips[page] || tips['dashboard.html'];
}

function getFeatureMiniTipKey(id) {
    const userId = state.user?.id || state.user?.user_id || 'guest';
    return `kontrakan_feature_tip_${FEATURE_MINI_TIP_VERSION}_${userId}_${id}`;
}

function markFeatureUsed(id) {
    if (!id || !state.user) return;
    localStorage.setItem(getFeatureMiniTipKey(id), 'done');
}

function queueFeatureMiniTip() {
    if (!state.user || state.user.must_change_password) return;
    if (localStorage.getItem(getFeatureTourKey()) !== 'done') return;
    const config = getFeatureMiniTipConfig();
    if (!config || localStorage.getItem(getFeatureMiniTipKey(config.id)) === 'done') return;
    setTimeout(() => {
        if (!state.user || document.querySelector('.feature-tour-overlay.active')) return;
        if (document.getElementById('featureMiniTip')) return;
        showFeatureMiniTip(config);
    }, 1700);
}

function showFeatureMiniTip(config) {
    const tip = document.createElement('div');
    tip.id = 'featureMiniTip';
    tip.className = 'feature-mini-tip';
    tip.innerHTML = `
        <div>
            <div class="feature-mini-tip-title">${escapeHtml(config.title)}</div>
            <div class="feature-mini-tip-body">${escapeHtml(config.body)}</div>
        </div>
        <button type="button" class="feature-mini-tip-close" aria-label="Tutup tip" onclick="dismissFeatureMiniTip(${safeJsonForAttr(config.id)})">&times;</button>
    `;
    document.body.appendChild(tip);
    requestAnimationFrame(() => tip.classList.add('show'));
}

function dismissFeatureMiniTip(id) {
    markFeatureUsed(id);
    const tip = document.getElementById('featureMiniTip');
    if (!tip) return;
    tip.classList.remove('show');
    setTimeout(() => tip.remove(), 200);
}

function queuePendingManualFeatureTour() {
    if (!state.user || state.user.must_change_password) return false;
    const resumed = resumeFeatureTourFromSession();
    if (resumed) return true;
    if (sessionStorage.getItem('kontrakan_start_feature_tour') !== '1') return false;
    sessionStorage.removeItem('kontrakan_start_feature_tour');
    setTimeout(() => {
        if (state.user && !document.querySelector('.feature-tour-overlay.active')) {
            startFeatureTour({ manual: true, stayOnPage: true });
        }
    }, 700);
    return true;
}

function startFeatureTour(options = {}) {
    featureTourManual = Boolean(options.manual);
    const page = getCurrentPageName();
    if (featureTourManual && !options.stayOnPage && !['dashboard.html', ''].includes(page)) {
        sessionStorage.setItem('kontrakan_start_feature_tour', '1');
        window.location.href = 'dashboard.html?tour=1';
        return;
    }
    featureTourSteps = getFeatureTourSteps();
    featureTourIndex = clampNumber(Number(options.index || 0), 0, featureTourSteps.length - 1);
    renderFeatureTour();
}

function finishFeatureTour(markDone = true) {
    const overlay = document.getElementById('featureTourOverlay');
    if (overlay) overlay.classList.remove('active');
    document.body.classList.remove('tour-open');
    removeFeatureTourListeners();
    sessionStorage.removeItem(FEATURE_TOUR_SESSION_KEY);
    if (markDone && state.user) {
        localStorage.setItem(getFeatureTourKey(), 'done');
        queueFeatureMiniTip();
    }
}

function resetFeatureTourProgress() {
    if (state.user) localStorage.removeItem(getFeatureTourKey());
    sessionStorage.removeItem(FEATURE_TOUR_SESSION_KEY);
    sessionStorage.removeItem(FEATURE_TOUR_PENDING_ACTION_KEY);
    showToast('Tour direset. Mulai ulang dari Home.', 'success');
    startFeatureTour({ manual: true });
}

function moveFeatureTour(delta) {
    const next = featureTourIndex + delta;
    if (next < 0 || next >= featureTourSteps.length) return;
    const nextStep = featureTourSteps[next];
    if (shouldNavigateForFeatureTour(nextStep)) {
        saveFeatureTourResume(next, featureTourManual);
        window.location.href = nextStep.page;
        return;
    }
    featureTourIndex = next;
    renderFeatureTour();
}

function resumeFeatureTourFromSession() {
    const raw = sessionStorage.getItem(FEATURE_TOUR_SESSION_KEY);
    if (!raw) return false;
    let data = null;
    try { data = JSON.parse(raw); } catch {}
    sessionStorage.removeItem(FEATURE_TOUR_SESSION_KEY);
    if (!data) return false;
    setTimeout(() => {
        if (!state.user || document.querySelector('.feature-tour-overlay.active')) return;
        startFeatureTour({ manual: Boolean(data.manual), stayOnPage: true, index: Number(data.index || 0) });
    }, 650);
    return true;
}

function saveFeatureTourResume(index, manual) {
    sessionStorage.setItem(FEATURE_TOUR_SESSION_KEY, JSON.stringify({ index, manual: Boolean(manual) }));
}

function shouldNavigateForFeatureTour(step) {
    if (!step?.page) return false;
    const current = getCurrentPageName();
    const target = step.page;
    return target !== current && !(target === 'dashboard.html' && current === '');
}

function renderFeatureTour() {
    if (!featureTourSteps.length) featureTourSteps = getFeatureTourSteps();
    const step = featureTourSteps[featureTourIndex];
    if (!step) return;

    let overlay = document.getElementById('featureTourOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'featureTourOverlay';
        overlay.className = 'feature-tour-overlay';
        document.body.appendChild(overlay);
    }

    const target = resolveFeatureTourTarget(step);
    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }

    const isFirst = featureTourIndex === 0;
    const isLast = featureTourIndex === featureTourSteps.length - 1;
    const ctaHtml = step.cta?.label
        ? `<button type="button" class="feature-tour-action" onclick="runFeatureTourAction()">${escapeHtml(step.cta.label)}</button>`
        : '';
    overlay.innerHTML = `
        <div class="feature-tour-spotlight" aria-hidden="true"></div>
        <div class="feature-tour-card" role="dialog" aria-modal="true" aria-labelledby="featureTourTitle">
            <div class="feature-tour-top">
                <span class="feature-tour-kicker">${escapeHtml(step.eyebrow)}</span>
                <button type="button" class="feature-tour-close" onclick="finishFeatureTour(true)" aria-label="Tutup tour">&times;</button>
            </div>
            <div class="feature-tour-progress">
                ${featureTourSteps.map((_, index) => `<span class="${index === featureTourIndex ? 'active' : ''}"></span>`).join('')}
            </div>
            <h2 id="featureTourTitle" class="feature-tour-title">${escapeHtml(step.title)}</h2>
            <p class="feature-tour-body">${escapeHtml(step.body)}</p>
            <div class="feature-tour-note">${escapeHtml(step.action)}</div>
            ${ctaHtml}
            <div class="feature-tour-footer">
                <button type="button" class="btn" onclick="finishFeatureTour(true)">${featureTourManual ? 'Tutup' : 'Lewati'}</button>
                <div class="feature-tour-nav">
                    <button type="button" class="btn" ${isFirst ? 'disabled style="visibility:hidden;"' : ''} onclick="moveFeatureTour(-1)">Kembali</button>
                    <button type="button" class="btn btn-primary" onclick="${isLast ? 'finishFeatureTour(true)' : 'moveFeatureTour(1)'}">${isLast ? 'Selesai' : 'Lanjut'}</button>
                </div>
            </div>
            <div class="feature-tour-count">${featureTourIndex + 1} / ${featureTourSteps.length}</div>
        </div>
    `;
    overlay.classList.add('active');
    document.body.classList.add('tour-open');
    addFeatureTourListeners();
    scheduleFeatureTourLayout();
}

function runFeatureTourAction() {
    const step = featureTourSteps[featureTourIndex];
    const cta = step?.cta;
    if (!cta) return;

    finishFeatureTour(true);
    if (cta.action) {
        sessionStorage.setItem(FEATURE_TOUR_PENDING_ACTION_KEY, cta.action);
    }

    const targetUrl = cta.url || step.page;
    if (targetUrl && shouldNavigateForUrl(targetUrl)) {
        window.location.href = targetUrl;
        return;
    }

    runPendingFeatureTourAction();
}

function shouldNavigateForUrl(url) {
    if (!url) return false;
    const current = getCurrentPageName();
    const target = url.split('?')[0].split('#')[0] || 'dashboard.html';
    return target !== current && !(target === 'dashboard.html' && current === '');
}

function runPendingFeatureTourAction() {
    const action = sessionStorage.getItem(FEATURE_TOUR_PENDING_ACTION_KEY);
    if (!action) return;
    sessionStorage.removeItem(FEATURE_TOUR_PENDING_ACTION_KEY);

    setTimeout(() => {
        if (action === 'open-jastip') {
            if (typeof window.openOpenJastipModal === 'function') {
                window.openOpenJastipModal();
            } else {
                document.getElementById('openJastipButton')?.click();
            }
            return;
        }

        if (action === 'enable-push') {
            const btn = document.getElementById('enablePushBtn');
            if (btn && !btn.classList.contains('hidden')) {
                btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                btn.focus();
                showToast('Tekan tombol ini untuk mengaktifkan notif HP.', 'info');
            }
            return;
        }

        if (action === 'focus-profile') {
            const input = document.getElementById('phoneWa') || document.getElementById('displayName');
            if (input) {
                input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                input.focus();
                showToast('Lengkapi profil lalu simpan.', 'info');
            }
        }
    }, 450);
}

function getFeatureTourSelectorList(step) {
    if (!step?.target) return [];
    return Array.isArray(step.target) ? step.target : [step.target];
}

function isFeatureTourElementVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}

function resolveFeatureTourTarget(step) {
    for (const selector of getFeatureTourSelectorList(step)) {
        const matches = document.querySelectorAll(selector);
        for (const element of matches) {
            if (isFeatureTourElementVisible(element)) return element;
        }
    }
    return null;
}

function scheduleFeatureTourLayout() {
    if (featureTourLayoutQueued) return;
    featureTourLayoutQueued = true;
    requestAnimationFrame(() => {
        featureTourLayoutQueued = false;
        positionFeatureTour();
        setTimeout(positionFeatureTour, 260);
    });
}

function clampNumber(value, min, max) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}

function positionFeatureTour() {
    const overlay = document.getElementById('featureTourOverlay');
    if (!overlay?.classList.contains('active')) return;

    const step = featureTourSteps[featureTourIndex];
    const card = overlay.querySelector('.feature-tour-card');
    const spotlight = overlay.querySelector('.feature-tour-spotlight');
    if (!card || !spotlight || !step) return;

    const target = resolveFeatureTourTarget(step);
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const gap = 14;
    const edge = 16;
    const cardWidth = Math.min(460, viewportWidth - edge * 2);

    card.style.width = `${cardWidth}px`;
    card.style.left = `${edge}px`;
    card.style.top = '';
    card.style.bottom = `calc(${edge}px + env(safe-area-inset-bottom))`;

    if (!target) {
        spotlight.classList.remove('active');
        return;
    }

    const rect = target.getBoundingClientRect();
    const padding = Math.min(12, Math.max(7, Math.round(Math.min(rect.width, rect.height) * 0.16)));
    const highlightTop = clampNumber(rect.top - padding, 8, viewportHeight - 20);
    const highlightLeft = clampNumber(rect.left - padding, 8, viewportWidth - 20);
    const highlightRight = clampNumber(rect.right + padding, 20, viewportWidth - 8);
    const highlightBottom = clampNumber(rect.bottom + padding, 20, viewportHeight - 8);
    const highlightWidth = Math.max(24, highlightRight - highlightLeft);
    const highlightHeight = Math.max(24, highlightBottom - highlightTop);

    spotlight.style.top = `${highlightTop}px`;
    spotlight.style.left = `${highlightLeft}px`;
    spotlight.style.width = `${highlightWidth}px`;
    spotlight.style.height = `${highlightHeight}px`;
    spotlight.classList.add('active');

    const cardHeight = card.offsetHeight || 260;
    const availableBelow = viewportHeight - highlightBottom - gap - edge;
    const availableAbove = highlightTop - gap - edge;
    const cardTop = availableBelow >= cardHeight || availableBelow >= availableAbove
        ? clampNumber(highlightBottom + gap, edge, viewportHeight - cardHeight - edge)
        : clampNumber(highlightTop - cardHeight - gap, edge, viewportHeight - cardHeight - edge);
    const targetCenter = highlightLeft + (highlightWidth / 2);
    const cardLeft = clampNumber(targetCenter - (cardWidth / 2), edge, viewportWidth - cardWidth - edge);

    card.style.left = `${cardLeft}px`;
    card.style.top = `${cardTop}px`;
    card.style.bottom = 'auto';
}

function addFeatureTourListeners() {
    window.addEventListener('resize', scheduleFeatureTourLayout);
    window.addEventListener('scroll', scheduleFeatureTourLayout, true);
}

function removeFeatureTourListeners() {
    window.removeEventListener('resize', scheduleFeatureTourLayout);
    window.removeEventListener('scroll', scheduleFeatureTourLayout, true);
}

document.addEventListener('keydown', (event) => {
    const active = document.getElementById('featureTourOverlay')?.classList.contains('active');
    if (!active) return;
    if (event.key === 'Escape') finishFeatureTour(true);
    if (event.key === 'ArrowRight') moveFeatureTour(1);
    if (event.key === 'ArrowLeft') moveFeatureTour(-1);
});

// ==================== API Cache (sessionStorage) ====================
// sessionStorage bertahan antar navigasi halaman dalam 1 tab
const _cacheTTL = {
  'users':         5 * 60 * 1000,  // 5 menit
  'balance':       45 * 1000,
  'expenses':      45 * 1000,
  'info':          60 * 1000,
  'notifications': 20 * 1000,
  'settlements':   45 * 1000,
  'jastip':         5 * 1000,
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
    const skipCache = !!options.skipCache;
    if ('skipCache' in options) {
        options = { ...options };
        delete options.skipCache;
    }

    // Serve GET requests from cache
    if (method === 'GET' && !skipCache) {
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
        if (method === 'GET' && !skipCache) _setCache(url, data);

        // Invalidate related caches on mutations
        if (['POST','PUT','DELETE'].includes(method)) {
            const ep = _getEndpoint(url);
            if (ep === 'expenses')     _invalidateCache(['expenses', 'balance', 'debt_details']);
            else if (ep === 'settlements') _invalidateCache(['settlements', 'balance', 'debt_details']);
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
async function apiGetFresh(endpoint) { return api(endpoint, { skipCache: true }); }
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
            setTimeout(() => { if (typeof refreshActiveJastipBanner === 'function') refreshActiveJastipBanner({ force: true }); }, 0);
            setTimeout(runPendingFeatureTourAction, 300);
            if (!queuePendingManualFeatureTour()) queueAutoFeatureTour();
            queueFeatureMiniTip();
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
            setTimeout(() => { if (typeof refreshActiveJastipBanner === 'function') refreshActiveJastipBanner({ force: true }); }, 0);
            setTimeout(runPendingFeatureTourAction, 300);
            if (!queuePendingManualFeatureTour()) queueAutoFeatureTour();
            queueFeatureMiniTip();
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
    setTimeout(() => { if (typeof refreshActiveJastipBanner === 'function') refreshActiveJastipBanner({ force: true }); }, 0);
    setTimeout(runPendingFeatureTourAction, 300);
    if (!queuePendingManualFeatureTour()) queueAutoFeatureTour();
    queueFeatureMiniTip();
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
    const result = await apiPost('expenses', data);
    markFeatureUsed('add-expense');
    return result;
}

async function deleteExpense(id) {
    return await apiDelete(`expenses?id=${id}`);
}

// ==================== Settlements ====================
async function loadSettlements() {
    return await apiGet('settlements');
}

async function createSettlement(toUser, amount) {
    const result = await apiPost('settlements', { to_user: toUser, amount });
    markFeatureUsed('settle');
    return result;
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
    const num = Number(amount);
    return 'Rp ' + (Number.isFinite(num) ? num : 0).toLocaleString('id-ID');
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

function formatDateFullSafe(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

function parseSplitItems(items) {
    try {
        let parsed = items;
        while (typeof parsed === 'string') parsed = JSON.parse(parsed);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function getSplitUserName(split) {
    return state.users.find(user => user.id == split.user_id)?.display_name
        || split.display_name
        || split.user_name
        || 'Unknown';
}

function renderEmptyState({ title = 'Belum ada data', body = '', action = '', actionText = 'Coba lagi' } = {}) {
    return `
        <div class="empty-state rich-empty">
            <div class="rich-empty-title">${escapeHtml(title)}</div>
            ${body ? `<div class="rich-empty-body">${escapeHtml(body)}</div>` : ''}
            ${action ? `<button class="btn btn-primary rich-empty-action" onclick="${escapeAttribute(action)}">${escapeHtml(actionText)}</button>` : ''}
        </div>
    `;
}

function renderSkeletonList(count = 3) {
    return `
        <div class="skeleton-list">
            ${Array.from({ length: count }).map(() => `
                <div class="skeleton-row">
                    <div class="skeleton skeleton-title"></div>
                    <div class="skeleton skeleton-line"></div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderTransactionDetailContent(tx, options = {}) {
    const isPayer = tx.paid_by == state.user?.id;
    const canDelete = options.canDelete ?? (isPayer || state.user?.role === 'admin');
    const deleteAction = options.deleteAction || `deleteExpenseFromDetail(${Number(tx.id)})`;
    const amountColor = tx.category === 'Listrik'
        ? 'var(--text-primary)'
        : (isPayer ? 'var(--green)' : 'var(--red)');
    const splits = Array.isArray(tx.splits) ? tx.splits : [];
    const itemCount = splits.reduce((sum, split) => sum + parseSplitItems(split.items).length, 0);

    let splitInfo = '';
    if (tx.category === 'Listrik') {
        splitInfo = `
            <div class="detail-section">
                <div class="detail-section-title">Pembagian</div>
                <div class="detail-muted">Sistem rotasi, tidak dibagi ke semua orang.</div>
            </div>
        `;
    } else if (splits.length > 0) {
        splitInfo = `
            <div class="detail-section">
                <div class="detail-section-title">Dibagi ke ${splits.length} orang${itemCount ? ` - ${itemCount} item` : ''}</div>
                <div class="detail-split-list">
                    ${splits.map(split => {
                        const userName = getSplitUserName(split);
                        const items = parseSplitItems(split.items);
                        return `
                            <div class="detail-split-card">
                                <div class="detail-split-head">
                                    <span>${escapeHtml(userName)}</span>
                                    <strong>${formatCurrencyPlain(split.amount || 0)}</strong>
                                </div>
                                ${items.length ? `
                                    <div class="detail-item-list">
                                        ${items.map(item => `
                                            <div class="detail-item-row">
                                                <div>
                                                    <div class="detail-item-name">${escapeHtml(item.item || item.item_name || 'Item')} ${item.qty ? `<span>x${escapeHtml(item.qty)}</span>` : ''}</div>
                                                    ${item.note ? `<div class="detail-muted">${escapeHtml(item.note)}</div>` : ''}
                                                </div>
                                                <strong>${formatCurrencyPlain(item.price || 0)}</strong>
                                            </div>
                                        `).join('')}
                                    </div>
                                ` : '<div class="detail-muted">Tidak ada rincian item.</div>'}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    return `
        ${tx.receipt_image ? `<img src="${escapeAttribute(imageUrl(tx.receipt_image))}" class="info-detail-image" alt="Bukti">` : ''}
        <h2 style="margin-bottom: var(--space-sm);">${escapeHtml(tx.description)}</h2>
        <div style="font-size: 1.5rem; font-weight: 700; color: ${amountColor}; margin-bottom: var(--space-md);">
            ${formatCurrencyPlain(tx.amount || 0)}
        </div>
        <div class="info-detail-meta">
            <div><strong>Kategori:</strong> ${escapeHtml(tx.category)}</div>
            <div><strong>Dibayar oleh:</strong> ${escapeHtml(tx.paid_by_name)}</div>
            <div><strong>Tanggal:</strong> ${formatDateFullSafe(tx.created_at)}</div>
        </div>
        ${splitInfo}
        ${canDelete ? `<button class="btn btn-danger btn-full mt-md" onclick="${escapeAttribute(deleteAction)}">Hapus Transaksi</button>` : ''}
    `;
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

// ==================== Active Jastip Banner ====================
let activeJastipRefreshTimer = null;
let activeJastipRefreshInFlight = null;

function shouldShowActiveJastipBanner() {
    const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
    if (currentPage !== 'dashboard.html') return false;
    if (!localStorage.getItem('kontrakan_token')) return false;
    return !!document.querySelector('.bottom-nav');
}

function getActiveJastipBanner() {
    let banner = document.getElementById('activeJastipBanner');
    if (banner) return banner;

    banner = document.createElement('div');
    banner.id = 'activeJastipBanner';
    banner.className = 'active-jastip-banner';
    banner.innerHTML = `
        <div class="active-jastip-icon">
            <svg viewBox="0 0 24 24"><path d="M6 2l1 5h10l1-5"/><path d="M3 7h18l-2 14H5L3 7z"/><path d="M9 11a3 3 0 0 0 6 0"/></svg>
        </div>
        <div class="active-jastip-copy">
            <div class="active-jastip-title">Jastip sedang open</div>
            <div class="active-jastip-subtitle">Cek nitipan kontrakan</div>
        </div>
        <button type="button" class="active-jastip-cta">Pantau</button>
    `;
    banner.addEventListener('click', () => {
        window.location.href = 'jastip.html';
    });
    document.body.appendChild(banner);
    return banner;
}

function hideActiveJastipBanner() {
    const banner = document.getElementById('activeJastipBanner');
    if (banner) banner.classList.remove('show');
    document.body.classList.remove('has-active-jastip-banner');
}

function renderActiveJastipBanner(orders = []) {
    const openOrders = orders.filter(order => order.status === 'open');
    if (!shouldShowActiveJastipBanner() || openOrders.length === 0) {
        hideActiveJastipBanner();
        return;
    }

    const first = openOrders[0];
    const itemCount = (first.items || []).length;
    const otherCount = openOrders.length - 1;
    const title = openOrders.length > 1
        ? `${openOrders.length} jastip sedang open`
        : `${first.opened_by_name || 'Teman'} buka jastip`;
    const subtitle = `${first.title}${itemCount ? ` - ${itemCount} nitipan` : ''}${otherCount ? ` - +${otherCount} lainnya` : ''}`;

    const banner = getActiveJastipBanner();
    banner.querySelector('.active-jastip-title').textContent = title;
    banner.querySelector('.active-jastip-subtitle').textContent = subtitle;
    banner.classList.add('show');
    document.body.classList.add('has-active-jastip-banner');
}

async function refreshActiveJastipBanner({ force = false } = {}) {
    if (!shouldShowActiveJastipBanner()) {
        hideActiveJastipBanner();
        return;
    }
    if (activeJastipRefreshInFlight && !force) return activeJastipRefreshInFlight;

    activeJastipRefreshInFlight = fetch(`${API_BASE}/jastip?status=open&limit=3&_=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
    })
        .then(async (res) => {
            if (!res.ok) throw new Error('Gagal memuat jastip aktif');
            const data = await res.json();
            renderActiveJastipBanner(data.orders || []);
        })
        .catch(() => {
            hideActiveJastipBanner();
        })
        .finally(() => {
            activeJastipRefreshInFlight = null;
        });

    return activeJastipRefreshInFlight;
}

function initActiveJastipBanner() {
    if (!shouldShowActiveJastipBanner()) return;
    refreshActiveJastipBanner({ force: true });

    if (!activeJastipRefreshTimer) {
        activeJastipRefreshTimer = setInterval(() => {
            if (document.visibilityState === 'visible') refreshActiveJastipBanner();
        }, 7000);
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshActiveJastipBanner({ force: true });
    }, { once: false });
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
    setTimeout(initActiveJastipBanner, 350);

    if ('serviceWorker' in navigator) {
        const swPath = window.location.hostname === 'localhost' ? '/Kontrakan/sw.js' : '/sw.js';
        navigator.serviceWorker.register(swPath)
            .then(() => console.log('SW registered'))
            .catch(err => console.error('SW failed:', err));
    }
});

// ==================== Push Notifications ====================
let pushPublicKeyPromise = null;
let pushAvailability = { checked: false, enabled: true, message: '' };
let pushSyncInFlight = null;
let pushSuccessShown = false;

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
                    pushAvailability = {
                        checked: true,
                        enabled: false,
                        message: data.error || 'Public key push tidak tersedia',
                    };
                    throw new Error(data.error || 'Public key push tidak tersedia');
                }
                pushAvailability = {
                    checked: true,
                    enabled: true,
                    message: '',
                };
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
    const testBtn = document.getElementById('testPushBtn');

    if (!btn && !status && !testBtn) return;

    let active = false;
    let message = 'Notif HP belum aktif';
    let statusType = 'muted';
    try {
        if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
            message = 'Browser ini belum mendukung push notification.';
            statusType = 'error';
        } else if (isIosDevice() && !isStandalonePwa()) {
            message = 'iPhone perlu buka app dari Home Screen agar push aktif.';
            statusType = 'warning';
        } else if (Notification.permission === 'denied') {
            message = 'Notif diblokir. Aktifkan lagi dari pengaturan browser.';
            statusType = 'error';
        } else if (pushAvailability.checked && !pushAvailability.enabled) {
            message = pushAvailability.message || 'Push belum dikonfigurasi di server.';
            statusType = 'error';
        } else {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription();
            active = Notification.permission === 'granted' && !!subscription;
            message = active
                ? 'Notifikasi HP aktif dan siap menerima update.'
                : 'Notif HP belum aktif. Aktifkan agar jastip dan tagihan tetap masuk.';
            statusType = active ? 'success' : 'muted';
        }
    } catch (err) {
        console.warn('Failed to update push UI:', err);
        message = 'Status notif belum bisa dicek.';
        statusType = 'warning';
    }

    if (btn) {
        btn.classList.toggle('hidden', active);
        btn.textContent = 'Aktifkan Notif HP';
    }
    if (status) {
        status.classList.remove('hidden');
        status.dataset.status = statusType;
        status.textContent = message;
    }
    if (testBtn) testBtn.classList.toggle('hidden', !active);
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

async function subscribeToPush(options = {}) {
    const { silent = false } = options;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (!silent) showToast('Browser ini belum mendukung notifikasi push.', 'error');
        return false;
    }

    if (isIosDevice() && !isStandalonePwa()) {
        if (!silent) showToast('Di iPhone, buka dari Home Screen dulu lalu aktifkan notif.', 'info');
        return false;
    }

    try {
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        const alreadySubscribed = !!subscription;

        if (!subscription) {
            const publicKey = await getPushPublicKey();
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey)
            });
        }

        await apiPost('push', { subscription });
        await updatePushUi();
        if (!silent && (!alreadySubscribed || !pushSuccessShown)) {
            showToast('Notifikasi HP berhasil diaktifkan.', 'success');
            pushSuccessShown = true;
        }
        return true;
    } catch (err) {
        console.error('Failed to subscribe to push:', err);
        if (!silent) {
            showToast(err.message || 'Gagal mengaktifkan notif HP. Coba refresh lalu ulangi.', 'error');
        }
        return false;
    }
}

async function syncPushSubscription(silent = true) {
    if (!state.user || !('Notification' in window)) return false;
    if (Notification.permission !== 'granted') {
        await updatePushUi();
        return false;
    }
    if (pushAvailability.checked && !pushAvailability.enabled) {
        return false;
    }
    if (!pushSyncInFlight) {
        pushSyncInFlight = subscribeToPush({ silent }).finally(() => {
            pushSyncInFlight = null;
        });
    }
    return pushSyncInFlight;
}


async function sendTestPushNotification() {
    try {
        const res = await fetch(`${API_BASE}/push?action=test`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || 'Gagal kirim tes notifikasi');
        }
        showToast('Tes notifikasi dikirim. Cek HP kamu sekarang.', 'success');
        return true;
    } catch (err) {
        console.error('Failed to send test push:', err);
        showToast(err.message || 'Tes notif gagal dikirim.', 'error');
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
        return syncPushSubscription(false);
    }

    if (Notification.permission === 'denied') {
        showToast('Notif sedang diblokir. Aktifkan lagi dari pengaturan browser.', 'error');
        return false;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
        return syncPushSubscription(false);
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
window.renderEmptyState = renderEmptyState;
window.renderSkeletonList = renderSkeletonList;
window.renderTransactionDetailContent = renderTransactionDetailContent;
window.refreshActiveJastipBanner = refreshActiveJastipBanner;
window.startFeatureTour = startFeatureTour;
window.finishFeatureTour = finishFeatureTour;
window.moveFeatureTour = moveFeatureTour;
window.runFeatureTourAction = runFeatureTourAction;
window.resetFeatureTourProgress = resetFeatureTourProgress;
