import { describe, expect, it } from "vitest";
import { northbeamStepIds as ids, toEngineModel, type BlockBundle, type ProcessBundle } from "@transpera-flow/db";
import { simulate } from "@transpera-flow/engine";
import { DEMO_GROUP_IDS, withDemoGroups } from "@/lib/demo/nested";
import { blockFromGroup, blockFromSteps, blockProblem, blockStepCount, insertBlock, readBlock, replaceProblem, replaceWithBlock } from "@/lib/blocks/blocks";
import { stepWarnings } from "@/lib/editor/commands";
import { diffBundles } from "@/lib/drafts/diff";
import { groupSteps } from "@/lib/editor/groups";
import { applyEdit, invertEdit } from "@/lib/editor/ops";
import { demoBundle } from "@/lib/sources/demo";

// The block library's pure edits (issue #116): saving a group as a block, putting a block in after the selection or in
// place of it, at any depth, with fresh ids that show as added.

const START = "2026-10-05";
const flat = () => demoBundle();
const nested = () => withDemoGroups(demoBundle());
const stepOf = (b: ProcessBundle, id: string) => b.steps.find((s) => s.id === id)!;
const from = (b: ProcessBundle, id: string) => b.edges.filter((e) => e.from_step_id === id);
const into = (b: ProcessBundle, id: string) => b.edges.filter((e) => e.to_step_id === id);
const childrenIds = (b: ProcessBundle, id: string) => b.steps.filter((s) => s.parent_step_id === id).map((s) => s.id);

/** The Sales conversation group of the nested demo, as a block. */
const sales = (): BlockBundle => blockFromGroup(nested(), DEMO_GROUP_IDS.conversation)!;

/** A block with a group inside a group: Campaign set-up with its first two steps grouped. */
function nestedBlock(): { block: BlockBundle; inner: string } {
  const b = nested();
  const made = groupSteps(b, [ids.seo, ids.ppc])!;
  const after = applyEdit(b, made.edit);
  return { block: blockFromGroup(after, DEMO_GROUP_IDS.setup)!, inner: made.id };
}

describe("saving a group as a block", () => {
  it("keeps the group's steps and the connections among them, with the group as the box they came from", () => {
    const block = sales();
    expect(block.steps.map((s) => s.name).sort()).toEqual(["Discovery call", "Qualify lead"]);
    expect(block.steps.every((s) => s.parent_step_id === null)).toBe(true);
    expect(block.edges.every((e) => block.steps.some((s) => s.id === e.from_step_id) && block.steps.some((s) => s.id === e.to_step_id))).toBe(true);
    expect(block.entry_step_id).toBe(ids.qualify);
    expect(blockStepCount(block)).toBe(2);
    expect(blockProblem(block)).toBeNull();
  });

  it("carries nothing of the process it came from", () => {
    for (const s of sales().steps) {
      expect(s).not.toHaveProperty("revision_id");
      expect(s).not.toHaveProperty("workspace_id");
      expect(s).not.toHaveProperty("process_id");
      expect(s.current_wip).toBeNull();
    }
  });

  it("keeps groups inside the group, at any depth, and counts only the work steps", () => {
    const { block, inner } = nestedBlock();
    expect(block.steps.find((s) => s.id === inner)!.parent_step_id).toBeNull();
    expect(block.steps.filter((s) => s.parent_step_id === inner)).toHaveLength(2);
    expect(blockStepCount(block)).toBe(3);
    expect(blockProblem(block)).toBeNull();
  });

  it("is only for groups", () => {
    expect(blockFromGroup(flat(), ids.seo)).toBeNull();
    expect(blockFromGroup(nested(), "nope")).toBeNull();
  });

  it("turns the whole map of block mode into a block at the top left, entered at its leftmost step", () => {
    const b = flat();
    const steps = b.steps.filter((s) => s.kind === "task").slice(0, 3);
    const mini = { steps: steps.map((s, i) => ({ ...s, x: 400 + i * 100, y: 300 })), edges: b.edges.filter((e) => steps.some((s) => s.id === e.from_step_id) && steps.some((s) => s.id === e.to_step_id)) };
    const block = blockFromSteps(mini);
    expect(Math.min(...block.steps.map((s) => Number(s.x)))).toBe(24);
    expect(Math.min(...block.steps.map((s) => Number(s.y)))).toBe(56);
    expect(block.entry_step_id).toBe(block.steps.sort((a, c) => Number(a.x) - Number(c.x))[0]!.id);
  });

  it("refuses a block with nothing in it, with start or end steps, or one that is malformed", () => {
    expect(blockProblem({ steps: [], edges: [], entry_step_id: null })).toMatch(/at least one step/);
    const start = { ...sales(), steps: [stepOf(flat(), ids.start)] } as unknown as BlockBundle;
    expect(blockProblem(start)).toMatch(/start and end/);
    expect(blockProblem(null)).not.toBeNull();
    expect(blockProblem({ steps: [{ id: "a", name: "A", kind: "task", parent_step_id: "ghost" }], edges: [] })).not.toBeNull();
    expect(readBlock({ steps: "no" })).toEqual({ steps: [], edges: [], entry_step_id: null });
    expect(readBlock(sales()).steps).toHaveLength(2);
  });
});

describe("inserting a block after the selection", () => {
  it("adds a group named after the block, joined in, with fresh ids that show as added", () => {
    const live = flat();
    const block = sales();
    const next = from(live, ids.audit)[0]!;
    const { edit, id } = insertBlock(live, ids.audit, block, "Sales conversation")!;
    const after = applyEdit(live, edit);
    const group = stepOf(after, id);
    expect(group.kind).toBe("group");
    expect(group.name).toBe("Sales conversation");
    expect(group.parent_step_id).toBeNull();
    // Its steps are copies with new ids, inside the group, entered where the block was.
    const inside = childrenIds(after, id);
    expect(inside).toHaveLength(2);
    expect(inside.some((i) => block.steps.some((s) => s.id === i))).toBe(false);
    expect(stepOf(after, group.entry_step_id!).name).toBe("Qualify lead");
    // Joined in: audit -> block -> what audit led to.
    expect(from(after, ids.audit).map((e) => e.to_step_id)).toEqual([id]);
    expect(from(after, id).map((e) => [e.to_step_id, Number(e.probability)])).toEqual([[next.to_step_id, 1]]);
    // Every new step and connection is added, and nothing else changed except the one connection that was re-pointed.
    const diff = diffBundles(live, after);
    expect([...diff.steps.values()].map((c) => c.kind)).toEqual(Array(3).fill("added"));
    expect(diff.steps.has(id)).toBe(true);
    for (const i of inside) expect(diff.steps.get(i)?.kind).toBe("added");
    expect(new Set(after.steps.map((s) => s.id)).size).toBe(after.steps.length);
    expect(new Set(after.edges.map((e) => e.id)).size).toBe(after.edges.length);
    expect(after.steps.every((s) => s.revision_id === live.revision.id && s.process_id === live.process.id)).toBe(true);
  });

  it("gives a second insert of the same block its own new ids", () => {
    const live = flat();
    const block = sales();
    const first = insertBlock(live, ids.audit, block, "A")!;
    const once = applyEdit(live, first.edit);
    const second = insertBlock(once, first.id, block, "B")!;
    const twice = applyEdit(once, second.edit);
    expect(twice.steps).toHaveLength(live.steps.length + 6);
    expect(new Set(twice.steps.map((s) => s.id)).size).toBe(twice.steps.length);
    expect(from(twice, first.id).map((e) => e.to_step_id)).toEqual([second.id]);
  });

  it("can be undone and redone", () => {
    const live = flat();
    const { edit } = insertBlock(live, ids.audit, sales(), "Sales conversation")!;
    const after = applyEdit(live, edit);
    const undone = applyEdit(after, invertEdit(edit));
    expect(undone.steps.map((s) => s.id).sort()).toEqual(live.steps.map((s) => s.id).sort());
    expect(undone.edges.map((e) => [e.id, e.to_step_id]).sort()).toEqual(live.edges.map((e) => [e.id, e.to_step_id]).sort());
  });

  it("lands inside the group the selected step is in, at any depth", () => {
    const b = nested();
    const { edit, id } = insertBlock(b, ids.seo, sales(), "Sales conversation")!;
    const after = applyEdit(b, edit);
    expect(stepOf(after, id).parent_step_id).toBe(DEMO_GROUP_IDS.setup);
    expect(childrenIds(after, id)).toHaveLength(2);
    // Two levels down: a block inside a group inside a group.
    const deep = applyEdit(b, groupSteps(b, [ids.seo])!.edit);
    const inner = deep.steps.find((s) => s.kind === "group" && s.parent_step_id === DEMO_GROUP_IDS.setup && s.id !== DEMO_GROUP_IDS.setup)!;
    const seo = stepOf(deep, ids.seo);
    expect(seo.parent_step_id).toBe(inner.id);
    const placed = insertBlock(deep, ids.seo, nestedBlock().block, "Setup again")!;
    const result = applyEdit(deep, placed.edit);
    expect(stepOf(result, placed.id).parent_step_id).toBe(inner.id);
    // The block's own inner group came along, a level below the new group.
    const kids = childrenIds(result, placed.id);
    expect(kids.map((k) => stepOf(result, k).kind).sort()).toEqual(["group", "task"].sort());
    const innerCopy = result.steps.find((s) => s.kind === "group" && kids.includes(s.id))!;
    expect(childrenIds(result, innerCopy.id)).toHaveLength(2);
    expect(innerCopy.id).not.toBe(nestedBlock().inner);
    // Every group's first step is one of its own.
    for (const g of result.steps.filter((s) => s.kind === "group")) expect(childrenIds(result, g.id)).toContain(g.entry_step_id);
  });

  it("puts it at the end of the top level, unconnected, with nothing selected", () => {
    const b = flat();
    const { edit, id, note } = insertBlock(b, null, sales(), "Sales conversation")!;
    const after = applyEdit(b, edit);
    expect(after.edges.filter((e) => e.from_step_id === id || e.to_step_id === id)).toHaveLength(0);
    expect(note).toBeUndefined();
  });

  it("joins a step with nothing after it, and leaves a step with branches or an end step to be connected by hand", () => {
    const b = flat();
    const leaf = b.steps.find((s) => s.kind !== "end" && s.kind !== "group" && !from(b, s.id).length);
    if (leaf) expect(from(applyEdit(b, insertBlock(b, leaf.id, sales(), "X")!.edit), leaf.id)).toHaveLength(1);
    const branching = b.steps.find((s) => from(b, s.id).length > 1)!;
    const branch = insertBlock(b, branching.id, sales(), "X")!;
    expect(branch.note).toMatch(/has branches/);
    expect(from(applyEdit(b, branch.edit), branching.id)).toHaveLength(from(b, branching.id).length);
    const end = b.steps.find((s) => s.kind === "end")!;
    const afterEnd = insertBlock(b, end.id, sales(), "X")!;
    expect(afterEnd.note).toMatch(/end step/);
  });

  it("refuses a block that can't be put in", () => {
    expect(insertBlock(flat(), ids.audit, { steps: [], edges: [], entry_step_id: null }, "Empty")).toBeNull();
  });

  it("still simulates, and the numbers flow through the new steps", () => {
    const b = nested();
    const { edit } = insertBlock(b, ids.seo, sales(), "Sales conversation")!;
    const after = applyEdit(b, edit);
    const model = toEngineModel(after, { startDate: START });
    expect(model.steps.some((s) => s.name === "Discovery call")).toBe(true);
    expect(() => simulate(model, 2, 1)).not.toThrow();
    // The block's steps leave through the group's connection, so none is flagged as a dead end.
    expect([...stepWarnings(after).values()].some((w) => /Nothing leaves/.test(w))).toBe(false);
  });
});

describe("replacing the selection with a block", () => {
  it("swaps a step for the block, keeping the connections in and out", () => {
    const live = flat();
    const before = into(live, ids.discovery).map((e) => e.from_step_id);
    const after_ = from(live, ids.discovery).map((e) => [e.to_step_id, Number(e.probability), e.condition_tag]);
    const { edit, id } = replaceWithBlock(live, ids.discovery, sales(), "Sales conversation")!;
    const after = applyEdit(live, edit);
    expect(after.steps.some((s) => s.id === ids.discovery)).toBe(false);
    expect(into(after, id).map((e) => e.from_step_id)).toEqual(before);
    expect(from(after, id).map((e) => [e.to_step_id, Number(e.probability), e.condition_tag])).toEqual(after_);
    // The group sits where the step was, and its steps show as added.
    expect(Number(stepOf(after, id).x)).toBe(Number(stepOf(live, ids.discovery).x));
    const diff = diffBundles(live, after);
    for (const c of childrenIds(after, id)) expect(diff.steps.get(c)?.kind).toBe("added");
    expect(diff.steps.get(ids.discovery)?.kind).toBe("removed");
  });

  it("swaps a group for the block, taking the steps inside it out", () => {
    const live = nested();
    const goneKids = childrenIds(live, DEMO_GROUP_IDS.setup);
    const { edit, id } = replaceWithBlock(live, DEMO_GROUP_IDS.setup, sales(), "Sales conversation")!;
    const after = applyEdit(live, edit);
    for (const g of [DEMO_GROUP_IDS.setup, ...goneKids]) expect(after.steps.some((s) => s.id === g)).toBe(false);
    expect(into(after, id).length).toBe(into(live, DEMO_GROUP_IDS.setup).length);
    expect(from(after, id).length).toBe(from(live, DEMO_GROUP_IDS.setup).length);
    // No connection is left pointing at a step that is gone.
    const present = new Set(after.steps.map((s) => s.id));
    expect(after.edges.every((e) => present.has(e.from_step_id) && present.has(e.to_step_id))).toBe(true);
  });

  it("works inside nested groups, and a group's first step that is replaced is replaced as the first step", () => {
    const b = nested();
    // Qualify lead is the first step of Sales conversation.
    const { edit, id } = replaceWithBlock(b, ids.qualify, nestedBlock().block, "Setup")!;
    const after = applyEdit(b, edit);
    expect(stepOf(after, id).parent_step_id).toBe(DEMO_GROUP_IDS.conversation);
    expect(stepOf(after, DEMO_GROUP_IDS.conversation).entry_step_id).toBe(id);
    expect(childrenIds(after, id)).toHaveLength(2);
    for (const g of after.steps.filter((s) => s.kind === "group")) expect(childrenIds(after, g.id)).toContain(g.entry_step_id);
    // Two levels down.
    const deep = applyEdit(b, groupSteps(b, [ids.qualify])!.edit);
    const inner = stepOf(deep, ids.qualify).parent_step_id!;
    const again = replaceWithBlock(deep, ids.qualify, sales(), "Sales")!;
    const result = applyEdit(deep, again.edit);
    expect(stepOf(result, again.id).parent_step_id).toBe(inner);
    expect(stepOf(result, inner).entry_step_id).toBe(again.id);
  });

  it("can be undone", () => {
    const live = nested();
    const { edit } = replaceWithBlock(live, DEMO_GROUP_IDS.setup, sales(), "Sales conversation")!;
    const undone = applyEdit(applyEdit(live, edit), invertEdit(edit));
    expect(undone.steps.map((s) => s.id).sort()).toEqual(live.steps.map((s) => s.id).sort());
    expect(undone.edges.map((e) => [e.id, e.from_step_id, e.to_step_id]).sort()).toEqual(live.edges.map((e) => [e.id, e.from_step_id, e.to_step_id]).sort());
  });

  it("clears a rework that pointed at the replaced step", () => {
    const live = flat();
    const loop = { ...stepOf(live, ids.audit), rework_to_step_id: ids.discovery, rework_rate: 0.1 };
    const b = { ...live, steps: live.steps.map((s) => (s.id === ids.audit ? loop : s)) };
    const after = applyEdit(b, replaceWithBlock(b, ids.discovery, sales(), "Sales conversation")!.edit);
    expect(stepOf(after, ids.audit).rework_to_step_id).toBeNull();
  });

  it("says why it can't, and does nothing", () => {
    const b = flat();
    expect(replaceProblem(b, null)).toMatch(/Select/);
    expect(replaceProblem(b, ids.start)).toMatch(/start and end/);
    expect(replaceProblem(b, ids.discovery)).toBeNull();
    expect(replaceWithBlock(b, ids.start, sales(), "X")).toBeNull();
    expect(replaceWithBlock(b, "ghost", sales(), "X")).toBeNull();
  });
});
