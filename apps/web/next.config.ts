import type { NextConfig } from "next";

// Chromium for the PDF report (issue #28; docs/adr/0009-pdf-reports.md): the
// brotli-packed binary in @sparticuz/chromium/bin is read at run time, not
// imported, so file tracing is told to ship it with the functions that print.
// Both packages are on Next's built-in serverExternalPackages list.
const CHROMIUM_BIN = ["./node_modules/@sparticuz/chromium/bin/**"];

const nextConfig: NextConfig = {
  transpilePackages: ["@transpera-flow/engine", "@transpera-flow/db", "@transpera-flow/mcp"],
  outputFileTracingIncludes: {
    "/api/reports": CHROMIUM_BIN,
    "/api/mcp": CHROMIUM_BIN,
    "/demo/report/pdf": CHROMIUM_BIN,
  },
};

export default nextConfig;
