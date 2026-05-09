const CACHE_NAME = 'kontrakan-v3';
const STATIC_ASSETS = [
    '/',
    '/login.html',
    '/dashboard.html',
    '/add-expense.html',
    '/history.html',
    '/settle.html',
    '/notifications.html',
    '/profile.html',
    '/css/style.css',
    '/js/app.js',
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
    if (event.request.method !== 'GET') return;
    if (event.request.url.includes('/api/')) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response && response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
                }
                return response;
            })
            .catch(() => caches.match(event.request))
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
        tag: data.tag || 'kontrakan-notification',
        renotify: true,
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
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                try {
                    const clientUrl = new URL(client.url);
                    const expectedUrl = new URL(targetUrl, self.location.origin);

                    if (clientUrl.pathname === expectedUrl.pathname && 'focus' in client) {
                        return client.focus();
                    }
                } catch (_) {}
            }

            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
