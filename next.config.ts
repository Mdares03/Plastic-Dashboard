import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["mis.maliountech.com.mx"],
};

// Opt-in bundle analysis: `ANALYZE=1 npm run build` writes treemap reports to
// .next/analyze/. Off by default so normal builds are unaffected.
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "1",
  openAnalyzer: false,
});

export default withBundleAnalyzer(nextConfig);
