import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@flowsim/engine", "@flowsim/db"],
};

export default nextConfig;
