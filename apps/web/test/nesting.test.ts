import { describe, expect, it } from "vitest";
import { northbeamStepIds as ids, rollUp, toEngineModel, visibleEdges, visibleSteps, type ProcessBundle } from "@transpera-flow/db";
import { simulate } from "@transpera-flow/engine";
import { DEMO_GROUP_IDS, withDemoGroups } from "@/lib/demo/nested";
import { deleteSteps, kindProblem, stepWarnings } from "@/lib/editor/commands";
import { demoBundle } from "@/lib/sources/demo";
import { GROUP_CARD, groupIds, openGroupSize } from "@/lib/map/groups";

// Groups on the process map (issue #102): the demo's nested view simulates as
// the flat demo does, closed groups roll their steps up, and the editor's
// commands treat a group and the steps inside it as one.

const START = "2026-10-05";
const flat = () => demoBundle();
const nested = () => withDemoGroups(demoBundle());
const modelOf = (b: ProcessBundle) => toEngineModel(b, { startDate: START });
const none = new Set<string>();

describe("the demo's nested view", () => {
  it("is the same model as the flat demo, so the same numbers", () => {
    expect(modelOf(nested())).toEqual(modelOf(flat()));
    expect(simulate(modelOf(nested()), 4, 1)).toEqual(simulate(modelOf(flat()), 4, 1));
  });

  it("has two groups, with their steps placed inside the box", () => {
    const b = nested();
    expect(groupIds(b.steps).sort()).toEqual([DEMO_GROUP_IDS.conversation, DEMO_GROUP_IDS.setup].sort());
    const qualify = b.steps.find((s) => s.id === ids.qualify)!;
    expect(qualify.parent_step_id).toBe(DEMO_GROUP_IDS.conversation);
    // Relative to the group: its padding in from the box's corner.
    expect([Number(qualify.x), Number(qualify.y)]).toEqual([24, 56]);
  });

  it("shows closed groups as one step each, with the connections rolled up to them", () => {
    const b = nested();
    expect(visibleSteps(b.steps, none).map((s) => s.name)).toEqual(
      expect.arrayContaining(["Sales conversation", "Campaign set-up", "Audit & proposal", "Client decision"]),
    );
    expect(visibleSteps(b.steps, none).map((s) => s.id)).not.toContain(ids.qualify);
    const edges = visibleEdges(b.steps, b.edges, none);
    // Start leads into the closed group; discovery's two branches leave it to audit and lost.
    expect(edges.find((e) => e.from === ids.start)).toMatchObject({ to: DEMO_GROUP_IDS.conversation, rolled: false });
    expect(edges.filter((e) => e.from === DEMO_GROUP_IDS.conversation).map((e) => e.to).sort()).toEqual([ids.audit, ids.lost].sort());
    // Open, every step and connection is back, and nothing is rolled up.
    const open = visibleEdges(b.steps, b.edges, new Set(groupIds(b.steps)));
    expect(open.some((e) => e.rolled)).toBe(false);
    expect(open).toHaveLength(b.edges.length);
  });

  it("rolls a closed group up: its steps, their hands-on time and their open issues", () => {
    const b = nested();
    const conversation = rollUp(b.steps, DEMO_GROUP_IDS.conversation, { issues: (id) => (id === ids.discovery ? 2 : 0) });
    expect(conversation).toEqual({ steps: 2, handsOnHours: 0.5 + 1.5, openIssues: 2, worstRating: null });
    const setup = rollUp(b.steps, DEMO_GROUP_IDS.setup);
    expect(setup.steps).toBe(3);
    expect(setup.handsOnHours).toBe(10 + 8 + 2);
  });

  it("sizes an open group around its steps, and falls back to a card when closed", () => {
    const b = nested();
    const box = openGroupSize(b.steps, DEMO_GROUP_IDS.conversation, new Set([DEMO_GROUP_IDS.conversation]));
    expect(box.width).toBeGreaterThan(24 + 176);
    expect(box.height).toBeGreaterThanOrEqual(120);
    expect(GROUP_CARD.width).toBeGreaterThan(176);
  });
});

describe("editing a nested process", () => {
  it("deleting a group deletes the steps inside it and their connections, in one edit", () => {
    const b = nested();
    const edit = deleteSteps(b, [DEMO_GROUP_IDS.setup])!;
    const removed = edit.ops.flatMap((op) => (op.kind === "remove" ? op.steps.map((s) => s.id) : []));
    expect(removed.sort()).toEqual([DEMO_GROUP_IDS.setup, ids.seo, ids.ppc, ids.live].sort());
    const gone = edit.ops.flatMap((op) => (op.kind === "remove" ? op.edges : []));
    // Kickoff's two branches into the group's steps, and seo, ppc and go-live's edges out.
    expect(gone.length).toBeGreaterThanOrEqual(5);
  });

  it("doesn't flag a step inside a group for having nothing leave it, or a group that is left from inside", () => {
    const b = nested();
    // The groups have no connections of their own: they are left from the steps inside (discovery, go-live).
    expect(stepWarnings(b).has(DEMO_GROUP_IDS.conversation)).toBe(false);
    expect(stepWarnings(b).has(DEMO_GROUP_IDS.setup)).toBe(false);
    // Go-live loses its connection: it is where the group ends, so it leaves through the group's own, and that is flagged on the group.
    const edges = b.edges.filter((e) => e.from_step_id !== ids.live);
    const warned = stepWarnings({ ...b, edges });
    expect(warned.has(ids.live)).toBe(false);
    expect(warned.get(DEMO_GROUP_IDS.setup)).toMatch(/Nothing leaves this group/);
    // The same step outside any group is flagged itself.
    const plain = flat();
    expect(stepWarnings({ ...plain, edges: plain.edges.filter((e) => e.from_step_id !== ids.live) }).has(ids.live)).toBe(true);
  });

  it("won't turn a group that holds steps into a task", () => {
    const b = nested();
    expect(kindProblem(b, DEMO_GROUP_IDS.setup, "task")).toMatch(/holds steps/);
    expect(kindProblem(b, ids.seo, "wait")).toBeNull();
  });
});
