import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // When APEX_BUILD_DIR is set (by scripts/qa-check.ts), the build
  // writes to that directory instead of the default ".next". This
  // keeps the verification build from clobbering a running
  // `pnpm dev` server: webpack-runtime in .next/ keeps stable chunk
  // ids while `next build` writes its own chunks to .next-qa/.
  // Real failure 2026-05-24: user hit "Cannot find module './647.js'"
  // every time qa:check ran while dev was open.
  distDir: process.env.APEX_BUILD_DIR ?? ".next",
};

export default nextConfig;
