import type { NextRequest } from "next/server";
import { demoPdfResponse } from "@/lib/report/demo-pdf";

// The demo's PDF (issue #28): the Northbeam report printed by headless
// Chromium in this function (docs/PRD.md §9, §10), nothing stored. A failure
// returns a readable 500 pointing at /demo/report/print (lib/report/demo-pdf.ts).
export const maxDuration = 300;

export async function GET(request: NextRequest): Promise<Response> {
  return demoPdfResponse(request);
}
