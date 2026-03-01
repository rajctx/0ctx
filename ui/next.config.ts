import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Include the Prisma generated client (including the WASM query compiler)
  // in Next.js file tracing so Vercel's serverless bundles have access to it.
  // Without this, `query_compiler_fast_bg.wasm` is not traced and PrismaClient
  // fails to initialise on cold start → prisma is undefined → HTTP 500 on all
  // API routes that touch the database.
  outputFileTracingIncludes: {
    '/api/**/*': ['./src/generated/prisma/**/*'],
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  org: "sentry",
  project: "nextjs",
});
