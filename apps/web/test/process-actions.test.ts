import { beforeEach, describe, expect, it, vi } from "vitest";

// Creating a servicing process from the app checks the name against the workspace's ordinary processes only: the company
// map (B11) is called "Company map" and must not take that name away from a process.

const db = vi.hoisted(() => ({
  filters: [] as unknown[][],
  rows: [{ name: "Company map", is_company: true }, { name: "Sales", is_company: false }],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    let onlyOrdinary = false;
    const chain = {
      select: () => chain,
      eq: (...args: unknown[]) => {
        db.filters.push(args);
        if (args[0] === "is_company" && args[1] === false) onlyOrdinary = true;
        return chain;
      },
      insert: () => chain,
      single: async () => ({ data: null, error: { code: "x" } }),
      then: (resolve: (v: unknown) => void) => resolve({ data: db.rows.filter((r) => !onlyOrdinary || !r.is_company), error: null }),
    };
    return {
      auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } } }) },
      from: () => chain,
    };
  },
}));
const { createServicingProcess } = await import("@/app/w/[slug]/process-actions");

const WS = "a0000000-0000-4000-8000-000000000001";
const form = (name: string) => {
  const f = new FormData();
  f.set("name", name);
  return f;
};

beforeEach(() => {
  db.filters = [];
});

describe("createServicingProcess", () => {
  it("lets a process be called 'Company map', but not the name of an ordinary one", async () => {
    // The name check leaves the company map out; the insert then fails in this fake, which is as far as it needs to go.
    expect(await createServicingProcess(WS, "northbeam", {}, form("Company map"))).toEqual({ error: "Couldn't create it. Try again." });
    expect(db.filters).toContainEqual(["is_company", false]);
    expect(await createServicingProcess(WS, "northbeam", {}, form("sales"))).toEqual({ error: "There is already a process called 'sales'." });
  });
});
