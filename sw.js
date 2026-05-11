const CACHE_NAME = 'kontrakan-v9';
const STATIC_ASSETS = [
    '/',
    '/login.html',
    '/dashboard.html',
    '/add-expense.html',
    '/history.html',
    '/settle.html',
    '/jastip.html',
    '/notifications.html',
    '/profile.html',
    '/css/style.css',
    '/js/app.js',
    '/manifest.json',
    '/icons/icon-512.png',
    '/apple-touch-icon.png'
];

const SETTLE_CLICK_FIX = `
<script>
(function () {
    if (!/settle\.html$|\/$/.test(window.location.pathname)) return;

    function rupiahToNumber(text) {
        const cleaned = String(text || '').replace(/[^0-9]/g, '');
        return cleaned ? parseInt(cleaned, 10) : 0;
    }

    function getBrokenOnclickData(item) {
        const raw = item && item.getAttribute ? (item.getAttribute('onclick') || '') : '';
        const match = raw.match(/show(Debt|Credit)Detail\\((\\d+)/);
        if (!match) return null;

        const titleEl = item.querySelector('.transaction-title');
        const amountEl = item.querySelector('.transaction-amount');
        const name = titleEl ? titleEl.textContent.trim() : '';
        const amount = rupiahToNumber(amountEl ? amountEl.textContent : '0');

        return {
            type: match[1].toLowerCase(),
            userId: parseInt(match[2], 10),
            name: name,
            amount: amount
        };
    }

    function activateItem(item) {
        const data = getBrokenOnclickData(item);
        if (!data || !data.userId || !data.amount) return;

        if (data.type === 'debt' && typeof window.showDebtDetail === 'function') {
            window.showDebtDetail(data.userId, data.name, data.amount);
        } else if (data.type === 'credit' && typeof window.showCreditDetail === 'function') {
            window.showCreditDetail(data.userId, data.name, data.amount);
        }
    }

    function enhanceList(listId, label) {
        const list = document.getElementById(listId);
        if (!list || list.dataset.clickFixReady === '1') return;
        list.dataset.clickFixReady = '1';

        list.addEventListener('click', function (event) {
            const item = event.target.closest('.transaction-item');
            if (!item || !list.contains(item)) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            activateItem(item);
        }, true);

        list.querySelectorAll('.transaction-item').forEach(function (item) {
            if (item.dataset.settleEnhanced === '1') return;
            item.dataset.settleEnhanced = '1';
            item.style.cursor = 'pointer';
            item.setAttribute('role', 'button');
            item.setAttribute('tabindex', '0');

            const amountEl = item.querySelector('.transaction-amount');
            if (amountEl && !amountEl.querySelector('.settle-inline-action')) {
                const btn = document.createElement('div');
                btn.className = 'settle-inline-action';
                btn.textContent = label;
                btn.style.cssText = 'margin-top:6px;font-size:.7rem;font-weight:700;text-align:right;opacity:.95;';
                amountEl.appendChild(btn);
            }

            item.addEventListener('keydown', function (event) {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    activateItem(item);
                }
            });
        });
    }

    function runFix() {
        enhanceList('myDebtsList', 'Bayar');
        enhanceList('myCreditsList', 'Tagih');
    }

    document.addEventListener('DOMContentLoaded', runFix);
    setInterval(runFix, 600);
})();
</script>
`;

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
            .catch(err => console.log('Cache failed:', err))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);

    if (request.method !== 'GET') return;
    if (url.origin !== self.location.origin) return;
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (url.pathname.startsWith('/api/')) return;
    if (url.pathname.startsWith('/.well-known/')) return;

    const isSettlePage = url.pathname === '/settle.html' || url.pathname.endsWith('/settle.html');
    if (isSettlePage) {
        event.respondWith(
            fetch(request)
                .then(async response => {
                    if (!response || response.status !== 200) return response;
                    const html = await response.clone().text();
                    const fixedHtml = html.includes('settle-inline-action')
                        ? html
                        : html.replace('</body>', SETTLE_CLICK_FIX + '\n</body>');
                    const fixedResponse = new Response(fixedHtml, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers
                    });
                    caches.open(CACHE_NAME)
                        .then(cache => cache.put(request, fixedResponse.clone()))
                        .catch(err => console.warn('Failed to cache settle response:', err));
                    return fixedResponse;
                })
                .catch(() => caches.match(request).then(cached => cached || Response.error()))
        );
        return;
    }

    event.respondWith(
        fetch(request)
            .then(response => {
                if (
                    response &&
                    response.status === 200 &&
                    response.type === 'basic' &&
                    ['http:', 'https:'].includes(url.protocol)
                ) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME)
                        .then(cache => cache.put(request, responseClone))
                        .catch(err => console.warn('Failed to cache response:', err));
                }
                return response;
            })
            .catch(() => caches.match(request).then(cached => cached || Response.error()))
    );
});

self.addEventListener('push', event => {
    let data = {
        title: 'Kontrakan Update',
        body: 'Ada pembaruan baru di aplikasi kontrakan.',
        url: '/notifications.html'
    };

    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
    }

    const options = {
        body: data.body,
        icon: data.icon || '/icons/icon-512.png',
        badge: data.badge || '/apple-touch-icon.png',
        vibrate: [100, 50, 100],
        tag: data.tag || `kontrakan-${Date.now()}`,
        renotify: true,
        requireInteraction: false,
        data: {
            dateOfArrival: Date.now(),
            url: data.url || '/notifications.html'
        }
    };

    event.waitUntil(self.registration.showNotification(data.title || 'Kontrakan', options));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();

    const targetUrl = (event.notification.data && event.notification.data.url) || '/notifications.html';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (const client of windowClients) {
                if ('focus' in client) {
                    client.navigate(targetUrl);
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
