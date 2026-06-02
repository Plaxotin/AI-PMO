import type { NextConfig } from "next";

/**
 * Vercel monorepo build serves Next under `/app`; browser calls use `/app/api/*`.
 * Local dev uses `/api/*` (no prefix). OAuth entry stays `/api/auth/*` (see vercel.json).
 */
const apiPrefix = process.env.VERCEL ? "/app" : "";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_API_PREFIX: apiPrefix,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "550mb",
    },
  },
};

export default nextConfig;
