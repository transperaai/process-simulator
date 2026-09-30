import { describe, expect, it } from "vitest";
import {
  bundleForProcess,
  northbeamBundle,
  northbeamPersonIds,
  northbeamServicingProcessIds,
  toEngineModel,
  unpublishedLive,
} from "@transpera-flow/db";
import { detectIssues, simulate } from "@transpera-flow/engine";
import { personClientLoads, type RosterData } from "@/lib/clients/roster";
import { MemoryDraftBackend, DraftSession } from "@/lib/drafts/session";
import { promoteInput } from "@/lib/issues/register";
import { parsePromoteInput } from "@/lib/issues/validate";
import { clientRetention, recurrenceFromValue, recurrenceOptions, recurrenceText, RECURRENCE_PRESETS } from "@/lib/servicing";

// Client servicing in the app (issue #19) and opening never-published processes (issue #76).

const START = "2026-10-05";

function roster(withServicing: boolean): RosterData {
  const b = northbeamBundle();
  return {
    workspace: b.workspace,
    canEdit: true,
    roles: b.roles,
    people: b.people,
    personRoles: b.personRoles,
    services: b.services,
    clients: b.clients!,
    clientServices: b.clientServices!,
    clientAssignments: b.clientAssignments!,
    ...(withServicing ? { servicingLinks: b.servicingLinks!, simulation: b } : {}),
  };
}

describe("recurrences in settings", () => {
  it("names the presets and round-trips them through the select's values", () => {
    expect(RECURRENCE_PRESETS.map(recurrenceText)).toEqual([
      "weekly",
      "fortnightly",
      "twice a month",
      "monthly",
      "every two months",
      "quarterly",
      "ad hoc, about 1 a month",
      "ad hoc, about 2 a month",
      "ad hoc, about 4 a month",
    ]);
    for (const o of recurrenceOptions(null)) expect(JSON.stringify(recurrenceFromValue(o.value))).toBe(o.value);
    expect(recurrenceFromValue("{\"every\":\"day\",\"times\":1}")).toBeNull();
    expect(recurrenceFromValue("not json")).toBeNull();
  });

  it("offers a stored value that isn't a preset", () => {
    const odd = { every: "week" as const, times: 3 };
    const options = recurrenceOptions(odd);
    expect(options[0]).toEqual({ value: JSON.stringify(odd), label: "3 times a week" });
    expect(options).toHaveLength(RECURRENCE_PRESETS.length + 1);
  });
});

describe("the Clients page", () => {
  it("a service with a servicing process adds no fallback load to the people looking after its clients", () => {
    const nina = northbeamPersonIds["Nina Kowalski"]!;
    const before = personClientLoads(roster(false)).find((l) => l.personId === nina)!;
    expect(before.hours).toBeCloseTo((8 * 19) / 4.33, 9);
    const after = personClientLoads(roster(true)).find((l) => l.personId === nina)!;
    expect(after.hours).toBe(0);
    expect(after.clients).toBe(8);
  });

  it("reads each client's simulated retention from the run", () => {
    const b = northbeamBundle();
    const r = simulate(toEngineModel(b, { startDate: START }), 10, 1);
    const swift = b.clients!.find((c) => c.name === "Swift Courier Co")!;
    const retention = clientRetention(r.clients![swift.id]!);
    expect(retention.start).toBe(47);
    expect(retention.trajectory).toHaveLength(14);
    expect(retention.churnMonthly).toBeGreaterThan(0.04);
    expect(retention.onTime + retention.late + retention.missed).toBeGreaterThan(5);
  });
});

describe("churn-risk issues in the register", () => {
  it("tracking one links its client", () => {
    const b = northbeamBundle();
    const model = toEngineModel(b, { startDate: START });
    const issue = detectIssues(model, simulate(model, 10, 1)).find((i) => i.type === "churn_risk")!;
    expect(issue.clientId).toBeTruthy();
    const input = promoteInput(issue, b.process.id, []);
    expect(input.client_id).toBe(issue.clientId);
    const parsed = parsePromoteInput(input);
    expect(parsed.ok && parsed.value.client_id).toBe(issue.clientId);
    expect(parsePromoteInput({ ...input, client_id: "nope" }).ok).toBe(false);
  });
});

describe("a never-published process (issue #76)", () => {
  it("opens in its draft against an empty live revision, and publishing makes the draft live", async () => {
    const draft = bundleForProcess(northbeamBundle(), northbeamServicingProcessIds.checkin!)!;
    const live = unpublishedLive(draft);
    const backend = new MemoryDraftBackend(live);
    const opened = await backend.open();
    expect(opened.status).toBe("ok");
    const session = new DraftSession(live, { bundle: { ...draft, revision: { ...draft.revision, id: opened.status === "ok" ? opened.revision.id : "" } }, number: 1 }, backend);
    // Everything in the draft is new against live.
    expect(session.getState().live.steps).toEqual([]);
    for (const s of draft.steps) await backend.store(session.currentRevision()).insert([s], []);
    await backend.store(session.currentRevision()).insert([], draft.edges);
    const published = await session.publish();
    expect(published?.status).toBe("published");
    expect(session.getState().live.revision.number).toBe(1);
    expect(backend.liveRows().steps.map((s) => s.id).sort()).toEqual(draft.steps.map((s) => s.id).sort());
  });
});
