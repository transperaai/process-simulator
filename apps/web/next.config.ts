import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@transpera-flow/engine", "@transpera-flow/db"],
};

export default nextConfig;
