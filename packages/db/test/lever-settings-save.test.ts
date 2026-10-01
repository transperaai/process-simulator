import { describe, expect, it } from "vitest";
import { loadLeverSettings, saveLeverSettings, type Db } from "../src";

// saveLeverSettings / loadLeverSettings (issue #109) against a small in-memory stand-in for the one table: the
// compare-and-set on `updated_at`, the conflict it reports, and a refused write. RLS itself is tested against
// Postgres in analysis-rules.test.ts.

interface Row {
  hidden: string[];
  updated_at: string;
}

function fakeDb(opts: { row?: Row | null; canWrite?: boolean } = {}) {
  let row: Row | null = opts.row ?? null;
  const canWrite = opts.canWrite ?? true;
  let tick = 0;
  const stamp = () => `2026-11-12T00:00:0${++tick}.000000+00:00`;
  const table = {
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
    }),
    insert: (v: { hidden: string[] }) => ({
      select: () => ({
        single: async () => {
          if (!canWrite) return { data: null, error: { code: "42501" } };
          if (row) return { data: null, error: { code: "23505" } };
          row = { hidden: v.hidden, updated_at: stamp() };
          return { data: row, error: null };
        },
      }),
    }),
    update: (v: { hidden: string[] }) => ({
      eq: () => ({
        eq: (_col: string, version: string) => ({
          select: async () => {
            // A row the user can't update is not visible to the update: no rows, no error.
            if (!canWrite || !row || row.updated_at !== version) return { data: [], error: null };
            row = { hidden: v.hidden, updated_at: stamp() };
            return { data: [row], error: null };
          },
        }),
      }),
    }),
  };
  return { db: { from: () => table } as unknown as Db, row: () => row };
}

const doc = ["process.time", "finances.prices"];

describe("loadLeverSettings", () => {
  it("shows every lever with no row, and reads a stored list", async () => {
    expect(await loadLeverSettings(fakeDb().db, "w")).toEqual({ hidden: [], version: null });
    const { db } = fakeDb({ row: { hidden: doc, updated_at: "v1" } });
    expect(await loadLeverSettings(db, "w")).toEqual({ hidden: doc, version: "v1" });
  });
});

describe("saveLeverSettings", () => {
  it("inserts the first save and updates later ones against the version it was given", async () => {
    const f = fakeDb();
    const first = await saveLeverSettings(f.db, "w", doc, null);
    expect(first.status).toBe("saved");
    if (first.status !== "saved") return;
    expect(first.settings.hidden).toEqual(doc);
    const second = await saveLeverSettings(f.db, "w", [], first.settings.version);
    expect(second.status).toBe("saved");
    expect(f.row()?.hidden).toEqual([]);
  });

  it("stores each id once", async () => {
    const f = fakeDb();
    await saveLeverSettings(f.db, "w", ["a", "b", "a"], null);
    expect(f.row()?.hidden).toEqual(["a", "b"]);
  });

  it("reports a conflict, with their list, when someone saved since", async () => {
    const f = fakeDb({ row: { hidden: doc, updated_at: "theirs" } });
    const stale = await saveLeverSettings(f.db, "w", ["process.wait"], "mine");
    expect(stale).toEqual({ status: "conflict", settings: { hidden: doc, version: "theirs" } });
    expect(f.row()?.hidden).toEqual(doc);
    // Two first saves: the second finds the row already there.
    const g = fakeDb({ row: { hidden: doc, updated_at: "theirs" } });
    expect((await saveLeverSettings(g.db, "w", [], null)).status).toBe("conflict");
  });

  it("is forbidden when the write isn't allowed", async () => {
    expect((await saveLeverSettings(fakeDb({ canWrite: false }).db, "w", doc, null)).status).toBe("forbidden");
    const update = await saveLeverSettings(fakeDb({ row: { hidden: [], updated_at: "v1" }, canWrite: false }).db, "w", doc, "v1");
    expect(update.status).toBe("forbidden");
  });

  it("rejects a list that isn't valid without touching the table", async () => {
    const f = fakeDb();
    expect((await saveLeverSettings(f.db, "w", Array.from({ length: 101 }, (_, i) => `l${i}`), null)).status).toBe("invalid");
    expect((await saveLeverSettings(f.db, "w", [""], null)).status).toBe("invalid");
    expect(f.row()).toBeNull();
  });
});
