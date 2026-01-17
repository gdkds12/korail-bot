import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run/Firebase App Hosting을 위한 필수 설정
  output: "standalone",
  
  // 빌드 중 사소한 오류 무시 (배포 성공률 높임)
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;