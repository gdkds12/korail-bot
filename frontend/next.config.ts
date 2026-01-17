import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

const config: NextConfig = {
  // Cloud Run/Firebase App Hosting을 위한 필수 설정
  output: "standalone",
  
  // Hardcode env vars to guarantee they are present at build time
  env: {
    NEXT_PUBLIC_FIREBASE_API_KEY: "AIzaSyB8SSArVgaVy9ZzH69F3XbpkLxTsmWpEy4",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "korail-bot.firebaseapp.com",
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "344770547705",
    NEXT_PUBLIC_FIREBASE_APP_ID: "1:344770547705:web:57aabbf291e28c370b7728",
  },
  images: {
    unoptimized: true,
  },
};

const nextConfig = withPWA({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: false, 
  workboxOptions: {
    disableDevLogs: true,
  },
})(config);

export default nextConfig;
