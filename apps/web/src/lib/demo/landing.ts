import { NORTHBEAM_PROCESS_ID } from "@transpera-flow/db";

/**
 * Where an old `/demo` link goes now that `/demo` is the Overview (issue #100): `?process=<id>` to that process's
 * map, `?nested=1` to the pipeline drawn with two groups. Null: no old link, show the Overview.
 */
export function demoLandingRedirect(process: string | string[] | undefined, nested: string | string[] | undefined): string | null {
  const suffix = nested === "1" ? "?nested=1" : "";
  if (typeof process === "string") return `/demo/p/${encodeURIComponent(process)}${suffix}`;
  if (nested === "1") return `/demo/p/${NORTHBEAM_PROCESS_ID}${suffix}`;
  return null;
}
