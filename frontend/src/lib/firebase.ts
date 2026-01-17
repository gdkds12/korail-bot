// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getMessaging, getToken } from "firebase/messaging";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyB8SSArVgaVy9ZzH69F3XbpkLxTsmWpEy4",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "korail-bot.firebaseapp.com",
  projectId: "korail-bot",
  storageBucket: "korail-bot.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "344770547705",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:344770547705:web:57aabbf291e28c370b7728"
};

// Check for mock config in browser
if (typeof window !== "undefined" && firebaseConfig.apiKey === "mock_key_for_build") {
  console.warn("⚠️ ALERT: Firebase is running with MOCK KEYS. Please check your Environment Variables in App Hosting and Re-deploy.");
}

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// FCM Logic
export const requestFcmToken = async (vapidKey: string) => {
  try {
    const messaging = getMessaging(app);
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const currentToken = await getToken(messaging, { vapidKey });
      if (currentToken) {
        return currentToken;
      } else {
        console.log('No registration token available. Request permission to generate one.');
        return null;
      }
    } else {
      console.log('Unable to get permission to notify.');
      return null;
    }
  } catch (err) {
    console.log('An error occurred while retrieving token. ', err);
    return null;
  }
};
