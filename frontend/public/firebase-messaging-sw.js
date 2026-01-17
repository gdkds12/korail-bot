importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

// Initialize the Firebase app in the service worker by passing in the
// messagingSenderId.
firebase.initializeApp({
  apiKey: "AIzaSyB8SSArVgaVy9ZzH69F3XbpkLxTsmWpEy4",
  authDomain: "korail-bot.firebaseapp.com",
  projectId: "korail-bot",
  storageBucket: "korail-bot.firebasestorage.app",
  messagingSenderId: "344770547705",
  appId: "1:344770547705:web:57aabbf291e28c370b7728",
});

// Retrieve an instance of Firebase Messaging so that it can handle background
// messages.
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  // Extract data from the 'data' field
  const title = payload.data?.title || "코레일 봇 알림";
  const body = payload.data?.body || "";

  const notificationOptions = {
    body: body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    vibrate: [200, 100, 200, 100, 200], // Stronger vibration
    tag: 'korail-status', // Prevent stacking duplicates
    renotify: true,      // Sound/Vibrate even if tag is same
    data: {
      click_url: '/'
    }
  };

  self.registration.showNotification(title, notificationOptions);
});
