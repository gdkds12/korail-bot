importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyB8SSArVgaVy9ZzH69F3XbpkLxTsmWpEy4",
  authDomain: "korail-bot.firebaseapp.com",
  projectId: "korail-bot",
  storageBucket: "korail-bot.firebasestorage.app",
  messagingSenderId: "344770547705",
  appId: "1:344770547705:web:57aabbf291e28c370b7728",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);

  // notification 페이로드가 있으면 Firebase SDK가 자동으로 표시하므로 중복 방지
  if (payload.notification) return;

  const notificationTitle = payload.data?.title || "코레일 봇 알림";
  const notificationOptions = {
    body: payload.data?.body || "",
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});