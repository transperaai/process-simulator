"use client";

import { useDemoHiddenLevers } from "./demo-store";

const NONE: string[] = [];

/**
 * The lever kinds a page hides: the workspace's, as loaded with the page, or on the demo the ones switched off in
 * this tab (so the demo's Levers page changes what the demo's process page shows).
 */
export function useHiddenLevers(demo: boolean, stored: string[] | undefined): string[] {
  const inTab = useDemoHiddenLevers();
  return demo ? inTab : (stored ?? NONE);
}
