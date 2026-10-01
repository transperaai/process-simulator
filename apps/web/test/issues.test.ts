import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NORTHBEAM_PROCESS_ID,
  northbeamBundle,
  northbeamIssues,
  northbeamPersonIds,
  northbeamRoleIds,
  northbeamScenarios,
  northbeamStepIds,
  toEngineModel,
  type IssueRow,
} from "@transpera-flow/db";
import { detectIssues, simulate, storedOfRating, type DetectedIssue } from "@transpera-flow/engine";
import {
  NO_FILTERS,
  entryView,
  filterEntries,
  fixFor,
  matchingScenario,
  promoteInput,
  registerEntries,
  stepBadges,
} from "@/lib/issues/register";
import { ALREADY_TRACKED, MemoryIssueStore } from "@/lib/issues/store";
import { cleanFieldValue, parseIssueInput, parsePromoteInput, type IssueInput } from "@/lib/issues/validate";

// A stand-in for Supabase behind the issue Server Actions: records what
// reaches the database, so the tests can show malformed input never does.
const db = vi.hoisted(() => ({ calls: [] as { op: string; args: unknown[] }[], signedIn: true, result: { data: null as unknown, error: null as unknown } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const chain = {
      insert: (...args: unknown[]) => (db.calls.push({ op: "insert", args }), chain),
      delete: () => (db.calls.push({ op: "delete", args: [] }), chain),
      eq: (...args: unknown[]) => (db.calls.push({ op: "eq", args }), chain),
      select: () => chain,
      single: async () => db.result,
      then: (resolve: (v: unknown) => void) => resolve(db.result),
    };
    return {
      auth: { getClaims: async () => ({ data: db.signedIn ? { claims: { sub: "u1" } } : null }) },
      from: (table: string) => (db.calls.push({ op: "from", args: [table] }), chain),
      rpc: async (fn: string, args: unknown) => (db.calls.push({ op: "rpc", args: [fn, args] }), db.result),
    };
  },
}));
const { createIssue, deleteIssue, promoteIssue, saveIssueField } = await import("@/app/w/[slug]/issue-actions");

const START = { startDate: "2026-10-05" };
const WS = northbeamBundle().workspace.id;
const audit = northbeamStepIds.audit;
const kickoff = northbeamStepIds.kickoff;
const scenarios = northbeamScenarios();

/**
 * Northbeam's detections, as the demo computes them, from its pooled client
 * load: the seeded roster (issue #18) adds overload findings about Nina
 * Kowalski, which the engine's tests cover. These tests are about the register,
 * so they use the single-point-of-failure detections the seeded issues track;
 * the rating rules' own findings (strategist, rework, waits) are tested in the engine.
 */
function northbeamDetections(): DetectedIssue[] {
  const b = northbeamBundle();
  const model = toEngineModel({ ...b, clients: [], clientServices: [], clientAssignments: [], clientGroups: [] }, START);
  return detectIssues(model, simulate(model, 30, 1)).filter((d) => d.key.startsWith("spof:"));
}

const manual: IssueInput = {
  title: "  Reports copied by hand ",
  type: "manual",
  severity: "serious",
  status: "open",
  evidence: "  ",
  process_id: NORTHBEAM_PROCESS_ID,
  step_id: audit,
  role_id: null,
  person_id: null,
  owner_person_id: northbeamPersonIds["Rosa Diaz"]!,
  scenario_id: null,
};

describe("the register merges tracked issues with this run's detections", () => {
  const detected = northbeamDetections();
  const entries = registerEntries(northbeamIssues(), detected);

  it("shows a promoted detection once, as tracked, and keeps the rest as detected", () => {
    expect(detected.map((d) => d.key)).toEqual([`spof:step:${audit}`, `spof:step:${kickoff}`]);
    expect(entries.map((e) => [e.kind, entryView(e).title])).toEqual([
      ["tracked", "Every proposal is built by hand"],
      ["tracked", "Only Maya Collins can do Audit & proposal"],
      ["detected", "Only Maya Collins can do Kickoff & strategy"],
      ["tracked", "Lead scoring could skip unqualified discovery calls"],
    ]);
    const promoted = entries[1]!;
    expect(promoted.kind === "tracked" && promoted.detection?.key).toBe(`spof:step:${audit}`);
  });

  it("isn't duplicated on the next run: the same model gives the same register", () => {
    const again = registerEntries(northbeamIssues(), northbeamDetections());
    expect(again.map((e) => entryView(e).id)).toEqual(entries.map((e) => entryView(e).id));
  });

  it("brings a done issue back when its detection fires again, but not a dismissed one", () => {
    const [, promoted] = northbeamIssues();
    const done = registerEntries([{ ...promoted!, status: "done" }], detected);
    expect(entryView(done.find((e) => e.kind === "tracked")!).open).toBe(true);
    const dismissed = registerEntries([{ ...promoted!, status: "dismissed" }], detected);
    expect(entryView(dismissed.find((e) => e.kind === "tracked")!).open).toBe(false);
    // Closed issues sort last.
    expect(dismissed.at(-1)!.kind).toBe("tracked");
  });

  it("filters by process, person, rating, source, status and step", () => {
    const titles = (f: Partial<typeof NO_FILTERS>) => filterEntries(entries, { ...NO_FILTERS, ...f }, NORTHBEAM_PROCESS_ID).map((e) => entryView(e).title);
    expect(titles({})).toHaveLength(4);
    expect(titles({ process: "c0000000-0000-4000-8000-00000000ffff" })).toEqual([]);
    expect(titles({ process: NORTHBEAM_PROCESS_ID })).toHaveLength(4);
    // About Maya, or owned by her: both spof issues name her.
    expect(titles({ person: northbeamPersonIds["Maya Collins"]! })).toEqual([
      "Only Maya Collins can do Audit & proposal",
      "Only Maya Collins can do Kickoff & strategy",
    ]);
    // Rosa owns the two audit issues.
    expect(titles({ person: northbeamPersonIds["Rosa Diaz"]! })).toHaveLength(2);
    expect(titles({ rating: "great" })).toEqual(["Lead scoring could skip unqualified discovery calls"]);
    expect(titles({ source: "detected" })).toEqual(["Only Maya Collins can do Kickoff & strategy"]);
    expect(titles({ source: "promoted" })).toEqual(["Only Maya Collins can do Audit & proposal"]);
    expect(titles({ source: "manual" })).toHaveLength(2);
    expect(titles({ status: "in_progress" })).toEqual(["Only Maya Collins can do Audit & proposal"]);
    expect(titles({ step: audit })).toHaveLength(2);
  });

  it("puts a badge on each step with open issues, coloured by the most severe", () => {
    const badges = stepBadges(entries);
    expect(Object.keys(badges).sort()).toEqual([northbeamStepIds.qualify, audit, kickoff].sort());
    expect(badges[audit]).toMatchObject({ count: 2, rating: "bad" });
    expect(badges[northbeamStepIds.qualify]).toMatchObject({ count: 1, rating: "great" });
  });
});

describe("run the fix", () => {
  const entries = registerEntries(northbeamIssues(), northbeamDetections());
  const byTitle = (t: string) => entries.find((e) => entryView(e).title.startsWith(t))!;

  it("uses the tracked issue's saved scenario", () => {
    expect(fixFor(byTitle("Every proposal"), scenarios)).toEqual({ name: "Automate proposals", scenarioId: scenarios[1]!.id, patch: scenarios[1]!.patch });
  });

  it("maps a detection's suggested fix to the saved scenario that makes the same change", () => {
    // Hire another Strategist is exactly "Hire a strategist".
    expect(fixFor(byTitle("Only Maya Collins can do Kickoff"), scenarios)).toMatchObject({ name: "Hire a strategist", scenarioId: scenarios[0]!.id });
    expect(matchingScenario([{ path: `roles.${northbeamRoleIds.strat}.headcount`, op: "add", value: 2 }], scenarios)).toBeNull();
  });

  it("falls back to the suggestion when no saved scenario matches, and to nothing when there is none", () => {
    expect(fixFor(byTitle("Only Maya Collins can do Kickoff"), [])).toMatchObject({ name: "Hire another Strategist", scenarioId: null });
    expect(fixFor(byTitle("Lead scoring"), scenarios)).toBeNull();
  });
});

describe("promoting a detection", () => {
  const kickoffSpof = northbeamDetections().find((d) => d.key === `spof:step:${kickoff}`)!;

  it("stores its fields and key, links the matching saved scenario, and starts open", async () => {
    const input = promoteInput(kickoffSpof, NORTHBEAM_PROCESS_ID, scenarios);
    // The rating is stored as the database's value for it (good = warning, bad = serious, risk = critical, great = info).
    expect(input.severity).toBe(storedOfRating(kickoffSpof.rating));
    expect(input).toMatchObject({ detected_key: kickoffSpof.key, step_id: kickoff, role_id: northbeamRoleIds.strat, scenario_id: scenarios[0]!.id });
    const store = new MemoryIssueStore(WS, northbeamIssues());
    const r = await store.promote(input);
    expect(r).toMatchObject({ status: "ok", issue: { source: "promoted", status: "open", detected_key: kickoffSpof.key, evidence_metrics: kickoffSpof.metrics } });
    // The next run lists it once, as tracked.
    const tracked = r.status === "ok" ? [...northbeamIssues(), r.issue] : [];
    const entries = registerEntries(tracked, northbeamDetections());
    expect(entries.filter((e) => entryView(e).title === kickoffSpof.title).map((e) => e.kind)).toEqual(["tracked"]);
    expect(entries.some((e) => e.kind === "detected")).toBe(false);
  });

  it("refuses to track the same detection twice", async () => {
    const store = new MemoryIssueStore(WS, northbeamIssues());
    const input = promoteInput(kickoffSpof, NORTHBEAM_PROCESS_ID, scenarios);
    expect((await store.promote(input)).status).toBe("ok");
    expect(await store.promote(input)).toEqual({ status: "error", message: ALREADY_TRACKED });
  });
});

describe("validation", () => {
  it("trims the title and blanks empty evidence", () => {
    expect(parseIssueInput(manual)).toEqual({ ok: true, value: { ...manual, title: "Reports copied by hand", evidence: null } });
  });

  it.each([
    [{ title: " " }, "Give the issue a title of up to 200 characters."],
    [{ title: "x".repeat(201) }, "Give the issue a title of up to 200 characters."],
    [{ type: "gremlins" }, "Pick a type."],
    [{ severity: "urgent" }, "Pick a rating."],
    [{ status: "closed" }, "Pick a status."],
    [{ evidence: "x".repeat(5001) }, "Keep the evidence to 5000 characters."],
    [{ step_id: "not-a-uuid" }, "That issue links to something that isn't valid."],
  ])("rejects %j", (fields, error) => {
    expect(parseIssueInput({ ...manual, ...fields })).toEqual({ ok: false, error });
  });

  it("checks a promoted detection's key and metrics", () => {
    const d = northbeamDetections()[0]!;
    const input = promoteInput(d, NORTHBEAM_PROCESS_ID, scenarios);
    expect(parsePromoteInput(input).ok).toBe(true);
    expect(parsePromoteInput({ ...input, detected_key: "not a key" }).ok).toBe(false);
    expect(parsePromoteInput({ ...input, evidence_metrics: { a: "1" } }).ok).toBe(false);
    expect(parsePromoteInput({ ...input, evidence_metrics: { a: Infinity } }).ok).toBe(false);
  });

  it("cleans one field's new value, or refuses it", () => {
    expect(cleanFieldValue("title", "  New title ")).toEqual({ value: "New title" });
    expect(cleanFieldValue("title", " ")).toBeNull();
    expect(cleanFieldValue("evidence", "  ")).toEqual({ value: null });
    expect(cleanFieldValue("status", "done")).toEqual({ value: "done" });
    expect(cleanFieldValue("status", "closed")).toBeNull();
    expect(cleanFieldValue("owner_person_id", "")).toEqual({ value: null });
    expect(cleanFieldValue("owner_person_id", 3)).toBeNull();
  });
});

describe("the demo store", () => {
  it("logs, edits with a same-field conflict check, closes and deletes", async () => {
    const store = new MemoryIssueStore(WS, [], () => "2026-10-01T00:00:00Z");
    const r = await store.create(manual);
    if (r.status !== "ok") throw new Error(r.message);
    expect(r.issue).toMatchObject({ source: "manual", detected_key: null, title: "Reports copied by hand", resolved_at: null });
    const id = r.issue.id;
    expect(await store.saveField(id, "status", "open", "done")).toEqual({ status: "saved", value: "done" });
    expect(await store.saveField(id, "status", "open", "dismissed")).toEqual({ status: "conflict", theirs: "done" });
    expect(await store.saveField(id, "severity", "serious", "critical")).toEqual({ status: "saved", value: "critical" });
    expect(await store.saveField(id, "title", "Reports copied by hand", "")).toMatchObject({ status: "error" });
    expect(await store.remove(id)).toEqual({ status: "ok" });
    expect(await store.saveField(id, "title", "x", "y")).toEqual({ status: "not_found" });
  });
});

describe("issue Server Actions", () => {
  beforeEach(() => {
    db.calls = [];
    db.signedIn = true;
    db.result = { data: null, error: null };
  });

  it("reject malformed input before touching the database", async () => {
    expect(await createIssue("not-a-uuid", manual)).toMatchObject({ status: "error" });
    expect(await createIssue(WS, { ...manual, title: "" })).toMatchObject({ status: "error" });
    expect(await createIssue(WS, { ...manual, type: "gremlins" })).toEqual({ status: "error", message: "Pick a type." });
    expect(await promoteIssue(WS, { ...manual, detected_key: "nope" })).toMatchObject({ status: "error" });
    expect(await saveIssueField("x", "title", "a", "b")).toMatchObject({ status: "error" });
    expect(await saveIssueField(northbeamIssues()[0]!.id, "source", "manual", "promoted")).toMatchObject({ status: "error" });
    expect(await saveIssueField(northbeamIssues()[0]!.id, "detected_key", null, "a:b:c")).toMatchObject({ status: "error" });
    expect(await saveIssueField(northbeamIssues()[0]!.id, "status", "open", "closed")).toMatchObject({ status: "error" });
    expect(await deleteIssue("x")).toMatchObject({ status: "error" });
    expect(db.calls).toEqual([]);
  });

  it("refuse a signed-out user", async () => {
    db.signedIn = false;
    expect(await createIssue(WS, manual)).toEqual({ status: "error", message: "Your session has ended. Sign in again." });
    expect(await saveIssueField(northbeamIssues()[0]!.id, "status", "open", "done")).toEqual({
      status: "error",
      message: "Your session has ended. Sign in again.",
    });
    expect(db.calls).toEqual([]);
  });

  it("insert a manual issue into the given workspace, with the parsed fields only", async () => {
    const row = { id: "i1" } as unknown as IssueRow;
    db.result = { data: row, error: null };
    expect(await createIssue(WS, { ...manual, workspace_id: "someone-elses", source: "promoted", detected_key: "a:b:c" })).toEqual({ status: "ok", issue: row });
    expect(db.calls[0]).toEqual({ op: "from", args: ["issues"] });
    const inserted = db.calls[1]!.args[0] as Record<string, unknown>;
    expect(inserted).toMatchObject({ workspace_id: WS, source: "manual", title: "Reports copied by hand", evidence: null });
    expect(inserted).not.toHaveProperty("detected_key");
  });

  it("promote with source 'promoted', status open and the detection's key", async () => {
    db.result = { data: { id: "i2" }, error: null };
    const d = northbeamDetections()[1]!;
    await promoteIssue(WS, { ...promoteInput(d, NORTHBEAM_PROCESS_ID, scenarios), status: "done" });
    expect(db.calls[1]!.args[0]).toMatchObject({ workspace_id: WS, source: "promoted", status: "open", detected_key: d.key });
  });

  it("say so when a detection is already tracked (unique key)", async () => {
    db.result = { data: null, error: { code: "23505" } };
    const d = northbeamDetections()[0]!;
    expect(await promoteIssue(WS, promoteInput(d, NORTHBEAM_PROCESS_ID, scenarios))).toEqual({ status: "error", message: ALREADY_TRACKED });
  });

  it("save one field through save_fields with its base", async () => {
    db.result = { data: { status: "saved", row: { status: "done" } }, error: null };
    const id = northbeamIssues()[0]!.id;
    expect(await saveIssueField(id, "status", "open", "done")).toEqual({ status: "saved", value: "done" });
    expect(db.calls).toEqual([{ op: "rpc", args: ["save_fields", { target: "issues", key: { id }, base: { status: "open" }, changes: { status: "done" } }] }]);
  });

  it("turn RLS refusals into a sentence", async () => {
    db.result = { data: null, error: { code: "42501" } };
    expect(await createIssue(WS, manual)).toEqual({ status: "error", message: "You don't have permission to change issues here." });
    db.result = { data: [], error: null };
    expect(await deleteIssue(northbeamIssues()[0]!.id)).toEqual({ status: "error", message: "You don't have permission to change issues here." });
  });
});
