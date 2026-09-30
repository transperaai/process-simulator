import { beforeEach, describe, expect, it, vi } from "vitest";
import { inUse, parseNewRole, parseRoleField, roleUsage, selectableRoles } from "@/lib/roles";

// Roles in the settings (issue #88): the checks, the usage counts and the
// Server Actions. A stand-in for Supabase records what reaches the database.
const db = vi.hoisted(() => ({
  calls: [] as { op: string; args: unknown[] }[],
  signedIn: true,
  result: { data: null as unknown, error: null as { code?: string } | null },
  refreshed: 0,
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: () => void (db.refreshed += 1) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const chain = {
      insert: (...args: unknown[]) => (db.calls.push({ op: "insert", args }), chain),
      delete: () => (db.calls.push({ op: "delete", args: [] }), chain),
      eq: (...args: unknown[]) => (db.calls.push({ op: "eq", args }), chain),
      select: () => chain,
      then: (resolve: (v: unknown) => void) => resolve(db.result),
    };
    return {
      auth: { getClaims: async () => ({ data: db.signedIn ? { claims: { sub: "u1" } } : null }) },
      from: (table: string) => (db.calls.push({ op: "from", args: [table] }), chain),
      rpc: async (fn: string, args: unknown) => (db.calls.push({ op: "rpc", args: [fn, args] }), db.result),
    };
  },
}));
const { createRole, removeRole, saveRoleField } = await import("@/app/w/[slug]/settings/actions");

const ROLE = "b0000000-0000-4000-8000-000000000001";
const WS = "a0000000-0000-4000-8000-000000000001";
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("parseRoleField", () => {
  it("accepts a name (trimmed) and the active flag", () => {
    expect(parseRoleField(ROLE, "name", "Finance", "  Finance and admin ")).toEqual({ roleId: ROLE, field: "name", base: "Finance", value: "Finance and admin" });
    expect(parseRoleField(ROLE, "active", true, false)).toEqual({ roleId: ROLE, field: "active", base: true, value: false });
  });
  it("refuses anything else", () => {
    expect(parseRoleField("nope", "name", "a", "b")).toBeNull();
    expect(parseRoleField(ROLE, "headcount", 1, 2)).toBeNull();
    expect(parseRoleField(ROLE, "name", "a", "   ")).toBeNull();
    expect(parseRoleField(ROLE, "name", "a", "x".repeat(201))).toBeNull();
    expect(parseRoleField(ROLE, "active", true, "no")).toBeNull();
    expect(parseRoleField(ROLE, "name", { a: 1 }, "b")).toBeNull();
  });
});

describe("parseNewRole", () => {
  it("trims the name, or asks for one", () => {
    expect(parseNewRole(form({ name: "  Copywriter " }))).toEqual({ name: "Copywriter" });
    expect(parseNewRole(form({ name: "   " }))).toEqual({ error: "Enter a name." });
    expect(parseNewRole(form({}))).toEqual({ error: "Enter a name." });
  });
});

describe("roleUsage", () => {
  it("counts distinct steps across revisions, people and clients", () => {
    const usage = roleUsage(
      [
        { id: "s1", role_id: "r1" },
        { id: "s1", role_id: "r1" }, // the same step in another revision
        { id: "s2", role_id: "r1" },
        { id: "s3", role_id: null },
      ],
      [
        { person_id: "p1", role_id: "r1" },
        { person_id: "p1", role_id: "r2" },
      ],
      [{ client_id: "c1", role_id: "r2" }],
      [
        { id: "v1", fallback_ongoing_load: { r3: 2 } },
        { id: "v2", fallback_ongoing_load: {} },
      ],
    );
    expect(usage).toEqual({
      r1: { steps: 2, people: 1, clients: 0, services: 0 },
      r2: { steps: 0, people: 1, clients: 1, services: 0 },
      r3: { steps: 0, people: 0, clients: 0, services: 1 },
    });
    expect(inUse(usage.r1)).toBe(true);
    // Only a service's fallback load names r3: the database refuses its delete too.
    expect(inUse(usage.r3)).toBe(true);
    expect(inUse(undefined)).toBe(false);
    expect(inUse({ steps: 0, people: 0, clients: 0, services: 0 })).toBe(false);
  });
});

describe("selectableRoles", () => {
  const roles = [
    { id: "a", active: true },
    { id: "b", active: false },
    { id: "c", active: false },
  ];
  it("hides inactive roles, except ones already chosen", () => {
    expect(selectableRoles(roles).map((r) => r.id)).toEqual(["a"]);
    expect(selectableRoles(roles, ["b", null]).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("the role actions", () => {
  beforeEach(() => {
    db.calls = [];
    db.signedIn = true;
    db.result = { data: [], error: null };
    db.refreshed = 0;
  });

  it("saves one field through save_fields and refreshes", async () => {
    db.result = { data: { status: "saved", row: { name: "Finance and admin" } }, error: null };
    expect(await saveRoleField(ROLE, "name", "Finance", " Finance and admin ")).toEqual({ status: "saved", value: "Finance and admin" });
    expect(db.calls).toEqual([
      { op: "rpc", args: ["save_fields", { target: "roles", key: { id: ROLE }, base: { name: "Finance" }, changes: { name: "Finance and admin" } }] },
    ]);
    expect(db.refreshed).toBe(1);
  });

  it("makes no call for malformed input, or when signed out", async () => {
    expect(await saveRoleField(ROLE, "name", "Finance", "  ")).toMatchObject({ status: "error" });
    expect(await saveRoleField("nope", "name", "Finance", "x")).toMatchObject({ status: "error" });
    db.signedIn = false;
    expect(await saveRoleField(ROLE, "name", "Finance", "x")).toMatchObject({ status: "error" });
    expect(db.calls).toEqual([]);
  });

  it("says a rename onto an existing name is taken", async () => {
    db.result = { data: null, error: { code: "23505" } };
    expect(await saveRoleField(ROLE, "name", "Finance", "Sales")).toEqual({ status: "error", message: "That name is already taken." });
    expect(db.refreshed).toBe(0);
  });

  it("adds a role", async () => {
    expect(await createRole(WS, {}, form({ name: " Copywriter " }))).toEqual({});
    expect(db.calls).toEqual([{ op: "from", args: ["roles"] }, { op: "insert", args: [{ workspace_id: WS, name: "Copywriter" }] }]);
    expect(db.refreshed).toBe(1);
  });

  it("refuses a blank name without a call, and names a duplicate", async () => {
    expect(await createRole(WS, {}, form({ name: " " }))).toEqual({ error: "Enter a name." });
    expect(db.calls).toEqual([]);
    db.result = { data: null, error: { code: "23505" } };
    expect(await createRole(WS, {}, form({ name: "Sales" }))).toEqual({ error: "There is already a role called 'Sales'." });
  });

  it("removes a role, and explains why it can't", async () => {
    db.result = { data: [{ id: ROLE }], error: null };
    expect(await removeRole(ROLE)).toEqual({});
    expect(db.refreshed).toBe(1);
    db.result = { data: null, error: { code: "23503" } };
    expect(await removeRole(ROLE)).toEqual({ error: "That role is still used by steps, people, clients or a service's fallback load. Make it inactive instead." });
    db.result = { data: [], error: null };
    expect(await removeRole(ROLE)).toEqual({ error: "That role was already removed, or you can't edit it." });
    expect(db.refreshed).toBe(1);
  });
});
