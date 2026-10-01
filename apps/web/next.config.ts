import path from "node:path";
import type { NextConfig } from "next";

// Next loads this file as CommonJS (so `__dirname` is the project directory);
// under Node's native TypeScript loader it is ESM, and the build runs from here.
const projectDir = typeof __dirname === "string" ? __dirname : process.cwd();
const monorepoRoot = path.join(projectDir, "../..");

const nextConfig: NextConfig = {
  transpilePackages: ["@transpera-flow/engine", "@transpera-flow/db", "@transpera-flow/mcp"],
  // Trace from the monorepo root: the pnpm store (node_modules/.pnpm) lives there.
  outputFileTracingRoot: monorepoRoot,
};

export default nextConfig;
