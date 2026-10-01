// The Editor's three modes (issue #104): one screen, with the hint under the title and the save buttons depending on
// what is being edited. Only `draft` is built here. `solution` (A49) and `block` (A51) plug into the same screen:
// they fill in `available` and their save handlers when they land.

export const EDITOR_MODES = ["draft", "solution", "block"] as const;
export type EditorMode = (typeof EDITOR_MODES)[number];

export interface ModeInfo {
  /** The screen's title: what is being edited. */
  title: (subject: string) => string;
  /** The line under the title: what the mode is and what it won't change. */
  hint: string;
  /** The buttons that save, in order; "draft" has two, the others one. */
  save: { id: "save-draft" | "publish" | "save-solution" | "save-block"; label: string; primary: boolean }[];
  /** Whether the mode is built yet. */
  available: boolean;
  /** Where its save buttons come from when it isn't (a ticket), for the tooltip. */
  arrivesWith?: string;
}

export const MODE_INFO: Record<EditorMode, ModeInfo> = {
  draft: {
    title: (subject) => `Draft of ${subject}`,
    hint: "You're editing a draft. The live map doesn't change until you publish. Publishing keeps the old version in History.",
    save: [
      { id: "save-draft", label: "Save draft", primary: false },
      { id: "publish", label: "Publish…", primary: true },
    ],
    available: true,
  },
  solution: {
    title: (subject) => `Solution for ${subject}`,
    hint: "Change the steps, simulate, then save. Solutions are saved on their own and never change the live map.",
    save: [{ id: "save-solution", label: "Save solution", primary: true }],
    available: false,
    arrivesWith: "Solutions",
  },
  block: {
    title: () => "New block",
    hint: "Build a bundle of steps. Save it to the library and reuse it in any solution or process.",
    save: [{ id: "save-block", label: "Save to library", primary: true }],
    available: false,
    arrivesWith: "The block library",
  },
};

/** The mode a `?mode=` parameter names; anything else is a draft. */
export function parseEditorMode(value: string | string[] | undefined): EditorMode {
  const v = Array.isArray(value) ? value[0] : value;
  return (EDITOR_MODES as readonly string[]).includes(v ?? "") ? (v as EditorMode) : "draft";
}

/**
 * Where Exit editor goes: the page the editor was opened from (`?from=`) if it is a page of this app, else `fallback`.
 * Only a path on this site is followed, never another address.
 */
export function exitHref(from: string | string[] | undefined, fallback: string): string {
  const v = Array.isArray(from) ? from[0] : from;
  if (!v) return fallback;
  // Resolve the way a browser does (it drops tabs and newlines, reads `\` as `/`), and follow only what stays on this site.
  const base = "http://self.invalid";
  try {
    const u = new URL(v, base);
    return u.origin === base && u.pathname.startsWith("/") && !u.pathname.startsWith("//") ? u.pathname + u.search + u.hash : fallback;
  } catch {
    return fallback;
  }
}

/** `/demo/edit` and `/w/<workspace>/p/<process>/edit`: the pages that are the Editor, which show no sidebar. */
export const isEditorPath = (path: string | null): boolean => !!path && /^\/(demo|w\/[^/]+\/p\/[^/]+)\/edit\/?$/.test(path);
