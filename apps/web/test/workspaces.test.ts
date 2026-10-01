import { beforeEach, describe, expect, it, vi } from "vitest";
import { isSlug, parseNewWorkspace, slugify } from "@/lib/workspaces";

// Creating a workspace (issue #88): the form's checks, and the Server Action
// that calls create_workspace. A stand-in for Supabase records what reaches it.
const db = vi.hoisted(() => ({
  calls: [] as { fn: string; args: unknown }[],
  signedIn: true,
  result: { data: null as unknown, error: null as { code?: string } | null },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: db.signedIn ? { claims: { sub: "u1" } } : null }) },
    rpc: async (fn: string, args: unknown) => (db.calls.push({ fn, args }), db.result),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
const { redirect } = await import("next/navigation");
const { createWorkspace } = await import("@/app/actions");

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("slugify", () => {
  it("lower-cases, drops accents and joins words with single dashes", () => {
    expect(slugify("Acme Dental & Co.")).toBe("acme-dental-co");
    expect(slugify("Café Río")).toBe("cafe-rio");
  });
  it("gives an empty slug for a name with no letters or digits", () => {
    expect(slugify("  --  ")).toBe("");
  });
  it("cuts to 60 characters without leaving a trailing dash", () => {
    const slug = slugify(`${"a".repeat(59)} bbb`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug).toBe("a".repeat(59));
    expect(slug.endsWith("-")).toBe(false);
    expect(isSlug(slugify("word ".repeat(30)))).toBe(true);
  });
});

describe("isSlug", () => {
  it("matches the database's check", () => {
    for (const ok of ["acme", "acme-dental", "a1-b2"]) expect(isSlug(ok), ok).toBe(true);
    for (const bad of ["", "Acme", "-acme", "acme-", "a--b", "a b", "a".repeat(61)]) expect(isSlug(bad), bad).toBe(false);
  });
});

describe("parseNewWorkspace", () => {
  it("takes the defaults, and the slug from the name", () => {
    expect(parseNewWorkspace(form({ name: "  Acme Dental " }))).toEqual({
      name: "Acme Dental",
      slug: "acme-dental",
      settings: { hours_per_week: 40, currency: "AUD", horizon_weeks: 13 },
    });
  });
  it("uses the values given, the slug trimmed and lower-cased and the currency upper-cased", () => {
    expect(parseNewWorkspace(form({ name: "Acme", slug: " Acme-2 ", hours_per_week: "37.5", currency: "usd", horizon_weeks: "26" }))).toEqual({
      name: "Acme",
      slug: "acme-2",
      settings: { hours_per_week: 37.5, currency: "USD", horizon_weeks: 26 },
    });
  });
  it("refuses what the database would", () => {
    const bad: Record<string, string>[] = [
      { name: "  " },
      { name: "x".repeat(201) },
      { name: "!!!" },
      { name: "Acme", slug: "not a slug" },
      { name: "Acme", hours_per_week: "0" },
      { name: "Acme", hours_per_week: "169" },
      { name: "Acme", hours_per_week: "lots" },
      { name: "Acme", currency: "pounds" },
      { name: "Acme", horizon_weeks: "1.5" },
      { name: "Acme", horizon_weeks: "0" },
      { name: "Acme", horizon_weeks: "105" },
    ];
    for (const fields of bad) expect(parseNewWorkspace(form(fields)), JSON.stringify(fields)).toHaveProperty("error");
  });
});

describe("the createWorkspace action", () => {
  beforeEach(() => {
    db.calls = [];
    db.signedIn = true;
    db.result = { data: "ws-1", error: null };
    vi.mocked(redirect).mockClear();
  });

  it("never reaches the database with bad input", async () => {
    expect(await createWorkspace({}, form({ name: "" }))).toHaveProperty("error");
    expect(await createWorkspace({}, form({ name: "Acme", hours_per_week: "0" }))).toHaveProperty("error");
    expect(db.calls).toEqual([]);
  });

  it("creates the workspace and goes to it", async () => {
    await expect(createWorkspace({}, form({ name: "Acme Dental", currency: "eur" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(db.calls).toEqual([
      {
        fn: "create_workspace",
        args: { ws_name: "Acme Dental", ws_slug: "acme-dental", ws_settings: { hours_per_week: 40, currency: "EUR", horizon_weeks: 13 } },
      },
    ]);
    expect(redirect).toHaveBeenCalledWith("/w/acme-dental");
  });

  it("says why it was refused", async () => {
    db.result = { data: null, error: { code: "42501" } };
    expect(await createWorkspace({}, form({ name: "Acme" }))).toEqual({ error: "Only agency admins can create workspaces." });
    db.result = { data: null, error: { code: "23505" } };
    expect(await createWorkspace({}, form({ name: "Acme" }))).toEqual({ error: "The address /w/acme is already taken. Choose another." });
    db.result = { data: null, error: { code: "23514" } };
    expect(await createWorkspace({}, form({ name: "Acme" }))).toEqual({ error: "Some of those values aren't allowed." });
    db.result = { data: null, error: { code: "XX000" } };
    expect(await createWorkspace({}, form({ name: "Acme" }))).toEqual({ error: "Couldn't create it. Try again." });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("asks a signed-out user to sign in, without calling the database", async () => {
    db.signedIn = false;
    expect(await createWorkspace({}, form({ name: "Acme" }))).toEqual({ error: "Your session has ended. Sign in again." });
    expect(db.calls).toEqual([]);
  });
});
