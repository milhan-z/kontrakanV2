const CACHE_NAME = 'kontrakan-v36';
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
    '/js/jastip-ux-fix.js',
    '/manifest.json',
    '/icons/icon-512.png',
    '/apple-touch-icon.png'
];

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
