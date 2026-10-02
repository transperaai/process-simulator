// Upload a process (issue #166, B13): what the preview dialog shows and what it sends back. Framework-free, so the
// server actions and the dialog share it and tests can run it. The file's own rules (the format, errors and warnings) are
// in packages/db/src/process-file.ts; the company's roles come from the server (packages/mcp/src/import-file.ts).

import type { ProcessFile } from "@transpera-flow/db/process-file";

/** A process file is a few kilobytes; this stops a wrong file (a video, a database dump) before it is read or sent. */
export const MAX_UPLOAD_BYTES = 500_000;

export interface UploadPreview {
  /** What the file is called, or the link; also what the change log says. */
  source: string;
  name: string;
  kind: ProcessFile["kind"];
  steps: number;
  links: number;
  groups: number;
  /** Problems that stop the upload: the person fixes the file (or asks Claude to) and uploads it again. */
  errors: string[];
  warnings: string[];
  /** The company's roles an unknown role can be mapped to. */
  roles: { id: string; name: string }[];
  /** Roles in the file the company has: shown as matched, nothing to do. */
  matchedRoles: { name: string; role: string }[];
  /** Roles in the file the company doesn't have: each is mapped to one of `roles` or left blank. Never created. */
  unknownRoles: string[];
  unknownPeople: string[];
  /** The name of a process that already has this name, if any. */
  nameTaken: string | null;
}

/** What the preview action returns: a preview to show, or why there isn't one. */
export type PreviewResult = { preview: UploadPreview; error?: undefined } | { preview?: undefined; error: string };

export interface CreateUploadInput {
  /** The file's text, checked again on the server. */
  text: string;
  /** The file name or link, for the change log. */
  source: string;
  /** A different name than the file gives. */
  name: string;
  /** For each unknown role: a company role id, or null to leave blank. */
  roleMap: Record<string, string | null>;
}

export interface CreateUploadResult {
  error?: string;
}

/** Why a file can't be read at all, before it is sent anywhere. */
export function uploadSizeProblem(bytes: number): string | null {
  return bytes > MAX_UPLOAD_BYTES
    ? `That file is ${Math.round(bytes / 1000).toLocaleString("en-GB")} KB. A process file is a few KB, so it is probably the wrong file. Upload the JSON file Claude made.`
    : null;
}

/** The file name as the change log says it: no folders, no control characters, at most 200 characters. */
export function sourceLabel(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (clean || "uploaded file").slice(0, 200);
}

/** The file Claude (or the person) made, as the example download: pretty-printed JSON. */
export function downloadHref(text: string): string {
  return `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
}
