import { describe, expect, it } from "vitest";
import { loadAnalysisRules, saveAnalysisRules, type Db } from "../src";

// saveAnalysisRules / loadAnalysisRules (issue #109) against a small in-memory stand-in for the one table: the
// compare-and-set on `updated_at`, the conflict it reports, and a refused write. RLS itself is tested against
// Postgres in analysis-rules.test.ts.

interface Row {
  settings: unknown;
  updated_at: string;
}

function fakeDb(opts: { row?: Row | null; canWrite?: boolean } = {}) {
  let row: Row | null = opts.row ?? null;
  const canWrite = opts.canWrite ?? true;
  let tick = 0;
  const stamp = () => `2026-11-04T00:00:0${++tick}.000000+00:00`;
  const table = {
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
    }),
    insert: (v: { settings: unknown }) => ({
      select: () => ({
        single: async () => {
          if (!canWrite) return { data: null, error: { code: "42501" } };
          if (row) return { data: null, error: { code: "23505" } };
          row = { settings: v.settings, updated_at: stamp() };
          return { data: row, error: null };
        },
      }),
    }),
    update: (v: { settings: unknown }) => ({
      eq: () => ({
        eq: (_col: string, version: string) => ({
          select: async () => {
            // A row the user can't update is not visible to the update: no rows, no error.
            if (!canWrite || !row || row.updated_at !== version) return { data: [], error: null };
            row = { settings: v.settings, updated_at: stamp() };
            return { data: [row], error: null };
          },
        }),
      }),
    }),
  };
  return { db: { from: () => table } as unknown as Db, row: () => row };
}

const doc = { rules: { busy: { inputs: [0.6, 0.8, 0.9] } } };

describe("loadAnalysisRules", () => {
  it("is all defaults with no row, and reads and cleans a stored one", async () => {
    expect(await loadAnalysisRules(fakeDb().db, "w")).toEqual({ settings: {}, version: null });
    const { db } = fakeDb({ row: { settings: { ...doc, junk: 1, rules: { ...doc.rules, nope: {} } }, updated_at: "v1" } });
    expect(await loadAnalysisRules(db, "w")).toEqual({ settings: doc, version: "v1" });
  });
});

describe("saveAnalysisRules", () => {
  it("inserts the first save and updates later ones against the version it was given", async () => {
    const f = fakeDb();
    const first = await saveAnalysisRules(f.db, "w", doc, null);
    expect(first.status).toBe("saved");
    if (first.status !== "saved") return;
    expect(first.rules.settings).toEqual(doc);
    const second = await saveAnalysisRules(f.db, "w", {}, first.rules.version);
    expect(second.status).toBe("saved");
    expect(f.row()?.settings).toEqual({});
  });

  it("reports a conflict, with their rules, when someone saved since", async () => {
    const f = fakeDb({ row: { settings: doc, updated_at: "theirs" } });
    const stale = await saveAnalysisRules(f.db, "w", { escalators: { badMonth: false } }, "mine");
    expect(stale).toEqual({ status: "conflict", rules: { settings: doc, version: "theirs" } });
    expect(f.row()?.settings).toEqual(doc);
    // Two first saves: the second finds the row already there.
    const g = fakeDb({ row: { settings: doc, updated_at: "theirs" } });
    expect((await saveAnalysisRules(g.db, "w", {}, null)).status).toBe("conflict");
  });

  it("is forbidden when the write isn't allowed", async () => {
    const insert = await saveAnalysisRules(fakeDb({ canWrite: false }).db, "w", doc, null);
    expect(insert.status).toBe("forbidden");
    const update = await saveAnalysisRules(fakeDb({ row: { settings: {}, updated_at: "v1" }, canWrite: false }).db, "w", doc, "v1");
    expect(update.status).toBe("forbidden");
  });

  it("rejects a document that isn't valid without touching the table", async () => {
    const f = fakeDb();
    const out = await saveAnalysisRules(f.db, "w", { rules: { busy: { inputs: [0.9, 0.5, 0.1] } } }, null);
    expect(out.status).toBe("invalid");
    expect(f.row()).toBeNull();
  });
});
