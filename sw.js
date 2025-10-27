self.addEventListener('install', (event) => {
    console.log('Service worker installing...');
});

self.addEventListener('activate', (event) => {
    console.log('Service worker activating...');
});

// Simulate background notification (e.g., for overspeeding)
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'notify') {
        self.registration.showNotification('Car Game Alert', {
            body: event.data.message,
            icon: 'icon-192.png'
        });
    }
});