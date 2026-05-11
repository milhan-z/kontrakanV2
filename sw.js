const CACHE_NAME = 'kontrakan-v15';
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
    '/js/settle-click-fix.js',
    '/manifest.json',
    '/icons/icon-512.png',
    '/apple-touch-icon.png'
];

function shouldInjectSettleFix(url) {
    return url.pathname === '/settle.html' || url.pathname.endsWith('/settle.html');
}

async function injectSettleFix(request, response) {
    if (!response || response.status !== 200) return response;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return response;

    const html = await response.clone().text();
    const scriptTag = '<script src="/js/settle-click-fix.js?v=15"></scr' + 'ipt>';

    let fixedHtml = html
        .replace(/<script\s+src=["']\/js\/settle-click-fix\.js(?:\?v=\d+)?["']><\/script>/g, '')
        .replace(/<script\s+src=["']js\/settle-click-fix\.js(?:\?v=\d+)?["']><\/script>/g, '');

    fixedHtml = fixedHtml.includes('</body>')
        ? fixedHtml.replace('</body>', scriptTag + '\n</body>')
        : fixedHtml + '\n' + scriptTag;

    return new Response(fixedHtml, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
    });
}

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

    event.respondWith(
        fetch(request)
            .then(async response => {
                let responseToReturn = response;

                if (shouldInjectSettleFix(url)) {
                    responseToReturn = await injectSettleFix(request, response);
                }

                if (
                    responseToReturn &&
                    responseToReturn.status === 200 &&
                    responseToReturn.type === 'basic' &&
                    ['http:', 'https:'].includes(url.protocol)
                ) {
                    const responseClone = responseToReturn.clone();
                    caches.open(CACHE_NAME)
                        .then(cache => cache.put(request, responseClone))
                        .catch(err => console.warn('Failed to cache response:', err));
                }
                return responseToReturn;
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
