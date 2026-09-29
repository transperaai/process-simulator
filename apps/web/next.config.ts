import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@transpera-flow/engine", "@transpera-flow/db", "@transpera-flow/mcp"],
};

export default nextConfig;
