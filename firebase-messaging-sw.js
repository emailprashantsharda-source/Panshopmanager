// hisaabnow — Firebase Cloud Messaging service worker
// v33_29az · June 2026
//
// PURPOSE
//   Handles background push notifications when the user is not actively
//   viewing the app. Foreground messages are handled by the main app
//   via onMessage() — see kfRequestFCMToken in index.html.
//
// SCOPE
//   Registered at scope '/firebase-cloud-messaging-push-scope/' to avoid
//   conflict with the existing /sw.js (which controls '/'). This file
//   itself lives at /firebase-messaging-sw.js (Firebase SDK requires
//   this exact filename for compat) but its scope is the sub-path.
//
// SAFETY
//   This SW only handles push events. It does NOT cache resources, does
//   NOT intercept fetch, does NOT control any page navigation. It coexists
//   peacefully with the app-shell SW at /sw.js.

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// IMPORTANT: this config MUST match the production project config in
// index.html. Service workers cannot read window.HISAABNOW_ENV — they
// run in a separate context. For now we hardcode the prod config since
// app.hisaabnow.com always uses production. Staging users will need
// a separate SW file if push is added to staging.
firebase.initializeApp({
  apiKey: "AIzaSyB8v9gYxCg4qBfLl2J08D9TeUVygKVAqC8",
  authDomain: "panshopmanager.firebaseapp.com",
  projectId: "panshopmanager",
  storageBucket: "panshopmanager.firebasestorage.app",
  messagingSenderId: "448042777087",
  appId: "1:448042777087:web:9b4c4a0bd4dbc425bccfca"
});

const messaging = firebase.messaging();

// Background message handler. Fires when:
//   - app is closed entirely
//   - app is open but tab not focused (some browsers)
//   - app is in another tab
//
// We use setBackgroundMessageHandler with a custom title/body so we
// can apply our branding (icon, badge, click action).
messaging.onBackgroundMessage(function(payload) {
  console.log('[FCM SW] Background message received:', payload);

  const notification = (payload && payload.notification) || {};
  const data = (payload && payload.data) || {};

  const title = notification.title || 'HisaabNow';
  const options = {
    body: notification.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: data.tag || 'hisaabnow-default', // notifications with same tag replace each other
    requireInteraction: false,
    data: {
      url: data.click_url || data.url || '/',
      ...data
    }
  };

  return self.registration.showNotification(title, options);
});

// When user taps a notification, open the app at the URL specified
// in the payload (or just /). If a window is already open, focus it.
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        // If there's already a window open, focus it
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url.indexOf(self.location.origin) !== -1 && 'focus' in client) {
            // Navigate to the target URL within the existing window
            if (targetUrl !== '/' && 'navigate' in client) {
              return client.navigate(targetUrl).then(c => c.focus());
            }
            return client.focus();
          }
        }
        // No window open, open a new one
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
