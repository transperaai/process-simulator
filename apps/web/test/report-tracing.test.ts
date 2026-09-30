import { existsSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

// The PDF routes ship Chromium through outputFileTracingIncludes (issue #28;
// docs/adr/0010-pdf-reports.md). @sparticuz/chromium looks for its brotli files
// in `bin/` next to its own code, which Node loads from the package's real
// directory (under node_modules/.pnpm with pnpm), so the glob must name that
// directory, not the apps/web/node_modules symlink: a glob through the symlink
// traced files the function then couldn't find ("The input directory … does
// not exist" on Vercel).

const webDir = path.resolve(__dirname, "..");
const chromiumEntry = createRequire(path.join(webDir, "package.json")).resolve("@sparticuz/chromium");
const binDir = path.join(path.dirname(path.dirname(chromiumEntry)), "bin");

describe("Chromium file tracing", () => {
  it.each(["/api/reports", "/api/mcp", "/demo/report/pdf"])("ships the bin directory @sparticuz/chromium reads for %s", (route) => {
    const globs = nextConfig.outputFileTracingIncludes?.[route] ?? [];
    expect(globs).toHaveLength(1);
    const dir = path.resolve(webDir, globs[0]!.replace(/\/\*\*$/, ""));
    expect(dir).toBe(binDir);
    expect(realpathSync(dir)).toBe(dir); // not through a symlink
    for (const f of ["chromium.br", "fonts.tar.br", "swiftshader.tar.br", "al2023.tar.br"]) expect(existsSync(path.join(dir, f))).toBe(true);
    expect(readdirSync(dir).length).toBeGreaterThanOrEqual(4);
  });

  it("traces from the monorepo root, where the pnpm store lives", () => {
    expect(path.resolve(nextConfig.outputFileTracingRoot!)).toBe(path.resolve(webDir, "../.."));
  });
});
