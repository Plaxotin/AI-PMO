import type { NextConfig } from "next";

/** Vercel builds from repo root via `app/package.json` — API lives under `/app`. */
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
