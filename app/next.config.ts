import type { NextConfig } from "next";

/** API routes are always at `/api/*` (local dev and Vercel). Do not use `/app` prefix. */
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_API_PREFIX: "",
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "550mb",
    },
  },
};

export default nextConfig;
