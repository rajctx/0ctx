import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  silent: true,
  org: "sentry",
  project: "nextjs",
});
