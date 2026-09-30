import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { NextConfig } from "next";

// Next loads this file as CommonJS (so `__dirname` is the project directory);
// under Node's native TypeScript loader it is ESM, and the build runs from here.
const projectDir = typeof __dirname === "string" ? __dirname : process.cwd();
const monorepoRoot = path.join(projectDir, "../..");

// Chromium for the PDF report (issue #28; docs/adr/0010-pdf-reports.md): the
// brotli-packed binary in @sparticuz/chromium/bin is read at run time, not
// imported, so file tracing is told to ship it with the functions that print.
// Both packages are on Next's built-in serverExternalPackages list.
//
// The glob must name the package's real directory. With pnpm,
// `apps/web/node_modules/@sparticuz/chromium` is a symlink into
// `node_modules/.pnpm/@sparticuz+chromium@<v>/…`; Node loads the package from
// that real path and `executablePath()` looks for `bin/` next to it. A glob
// through the symlink traced the files under the symlink's path instead, and
// the function bundle (which doesn't keep that symlink) had no `bin/` where
// the package looks: "The input directory … does not exist" on Vercel.
function chromiumBinGlob(): string {
  const entry = createRequire(path.join(projectDir, "package.json")).resolve("@sparticuz/chromium"); // <pkg>/build/index.js
  const pkgDir = realpathSync(path.dirname(path.dirname(entry)));
  return `${path.relative(projectDir, path.join(pkgDir, "bin")).split(path.sep).join("/")}/**`;
}
const CHROMIUM_BIN = [chromiumBinGlob()];

const nextConfig: NextConfig = {
  transpilePackages: ["@transpera-flow/engine", "@transpera-flow/db", "@transpera-flow/mcp"],
  // Trace from the monorepo root: the pnpm store (node_modules/.pnpm) lives there.
  outputFileTracingRoot: monorepoRoot,
  outputFileTracingIncludes: {
    "/api/reports": CHROMIUM_BIN,
    "/api/mcp": CHROMIUM_BIN,
    "/demo/report/pdf": CHROMIUM_BIN,
  },
};

export default nextConfig;
