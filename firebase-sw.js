// KrodAI Service Worker — Push Notifications
// firebase-sw.js — place this file in your GitHub repo ROOT folder

importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyB8v9gYxCg4qBfLl2J08D9TeUVygKVAqC8",
  authDomain: "panshopmanager.firebaseapp.com",
  projectId: "panshopmanager",
  messagingSenderId: "448042777087",
  appId: "1:448042777087:web:003499456e27e4dbbccfca"
});

const messaging = firebase.messaging();

// Background notification handler
messaging.onBackgroundMessage(function(payload) {
  console.log("KrodAI push received:", payload);
  var title = payload.notification.title || "KrodAI";
  var body  = payload.notification.body  || "";
  var icon  = payload.notification.icon  || "/icon-192.png";
  var data  = payload.data || {};

  self.registration.showNotification(title, {
    body:  body,
    icon:  icon,
    badge: "/icon-192.png",
    data:  data,
    vibrate: [200, 100, 200],
    actions: [
      { action: "open", title: "App Kholo" }
    ]
  });
});

// Notification click handler
self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  var url = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.includes(self.location.origin)) {
          list[i].focus();
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});
