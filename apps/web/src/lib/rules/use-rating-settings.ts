"use client";

import type { AnalysisSettings } from "@transpera-flow/engine";
import { useDemoAnalysisRules } from "./demo-store";

const NONE: AnalysisSettings = {};

/**
 * The analysis rules a page rates its run with: the workspace's, as loaded with the page, or on the demo the ones
 * edited in this tab (so changing a rule on the demo's rules page re-rates the demo's issues).
 */
export function useRatingSettings(demo: boolean, stored: AnalysisSettings | undefined): AnalysisSettings {
  const inTab = useDemoAnalysisRules();
  return demo ? inTab : (stored ?? NONE);
}
