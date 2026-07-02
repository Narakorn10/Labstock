import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: false,
  skipTrailingSlashRedirect: true,
  experimental: {
    workerThreads: true,
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
