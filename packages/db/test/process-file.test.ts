import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { checkProcessFile, checkProcessFileText, claudePrompt, PROCESS_FILE_EXAMPLE, PROCESS_FILE_SCHEMA, rolesInFile } from "../src/process-file";

// The transpera-process/1 checker (issue #166): what it accepts, and the plain-word message for each way a file can be
// wrong. Pure; no database.

// JSON.parse is typed loosely on purpose: the tests break a file in one way at a time, by reaching into it.
const clone = (v: unknown) => JSON.parse(JSON.stringify(v));
const example = () => clone(PROCESS_FILE_EXAMPLE);
const published = (name: string) => readFileSync(new URL(`../../../docs/import/${name}`, import.meta.url), "utf8");

/** A small valid process to break in one way at a time. */
function base() {
  return clone({
    format: "transpera-process/1",
    name: "Small",
    steps: [
      { id: "a", name: "Begin", type: "start" },
      { id: "b", name: "Work", type: "step", hands_on_hours: 1 },
      { id: "c", name: "Finish", type: "end" },
    ],
    links: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ],
  });
}

describe("the published schema and example", () => {
  it("the example file validates against the schema file, and passes the checker clean", () => {
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(JSON.parse(published("transpera-process-1.schema.json")));
    const example = JSON.parse(published("transpera-process-1.example.json"));
    expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
    const checked = checkProcessFile(example);
    expect(checked.errors).toEqual([]);
    expect(checked.warnings).toEqual([]);
  });

  it("the schema rejects a file with the wrong format or a missing step id", () => {
    const validate = new Ajv2020({ strict: false }).compile(JSON.parse(published("transpera-process-1.schema.json")));
    expect(validate({ ...example(), format: "transpera-process/2" })).toBe(false);
    const noId = example();
    delete noId.steps[0].id;
    expect(validate(noId)).toBe(false);
  });

  it("the docs copies are the ones generated from the source (pnpm --filter @transpera-flow/db gen:import-schema)", () => {
    expect(JSON.parse(published("transpera-process-1.schema.json"))).toEqual(PROCESS_FILE_SCHEMA);
    expect(JSON.parse(published("transpera-process-1.example.json"))).toEqual(PROCESS_FILE_EXAMPLE);
  });

  it("the prompt for Claude carries the schema and the example", () => {
    const prompt = claudePrompt();
    expect(prompt).toContain("transpera-process/1");
    expect(prompt).toContain(JSON.stringify(PROCESS_FILE_SCHEMA, null, 2));
    expect(prompt).toContain("Enquiry to signed client");
  });
});

describe("accepting a file", () => {
  it("fills in defaults: a pipeline, a type for every step, no groups", () => {
    const f = base();
    delete f.steps[1].type;
    const { file, errors, warnings } = checkProcessFile(f);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(file).toMatchObject({ name: "Small", kind: "pipeline", groups: [] });
    expect(file!.steps.map((s) => s.type)).toEqual(["start", "step", "end"]);
  });

  it("lists the roles the file names, once each, ignoring case", () => {
    const f = example();
    f.steps[3].role = "managing DIRECTOR";
    f.steps[4].role = "Account manager";
    expect(rolesInFile(checkProcessFile(f).file!)).toEqual([
      { name: "Managing director", steps: 3 },
      { name: "Account manager", steps: 1 },
    ]);
  });

  it("reads JSON text, with or without a byte-order mark", () => {
    expect(checkProcessFileText(`﻿${JSON.stringify(base())}`).errors).toEqual([]);
    expect(checkProcessFileText("{ not json").errors[0]).toMatch(/isn't valid JSON/);
  });
});

describe("the format", () => {
  it("says a missing format plainly", () => {
    const f = base();
    delete f.format;
    expect(checkProcessFile(f).errors).toEqual([`The file doesn't say which format it is in. Add "format": "transpera-process/1" at the top.`]);
  });

  it("says a different format plainly, and a newer version differently", () => {
    expect(checkProcessFile({ ...base(), format: "bpmn" }).errors[0]).toMatch(/says its format is 'bpmn', but Transpera reads 'transpera-process\/1'/);
    expect(checkProcessFile({ ...base(), format: "transpera-process/2" }).errors[0]).toMatch(/in format 'transpera-process\/2', but this version of Transpera reads 'transpera-process\/1'/);
  });

  it("refuses something that isn't an object", () => {
    expect(checkProcessFile([1, 2]).errors[0]).toMatch(/isn't a process/);
    expect(checkProcessFile(null).file).toBeNull();
  });
});

describe("errors", () => {
  it("names the step a link goes to that isn't a step, and suggests the near miss", () => {
    const f = example();
    f.links[1].to = "cal";
    expect(checkProcessFile(f).errors).toEqual(["Link from 'review' goes to 'cal', which isn't a step. Did you mean 'call'?"]);
  });

  it("names a link that starts at a step that isn't there", () => {
    const f = base();
    f.links[0].from = "zzzzzz";
    expect(checkProcessFile(f).errors).toEqual(["Link from 'zzzzzz' goes to 'b', but 'zzzzzz' isn't a step."]);
  });

  it("refuses duplicate step ids and duplicate names", () => {
    const f = base();
    f.steps[2].id = "b";
    expect(checkProcessFile(f).errors).toContain("Two steps have the id 'b' ('Work' and 'Finish'). Every step needs its own id.");
    const g = base();
    g.steps[2].name = "work";
    expect(checkProcessFile(g).errors).toContain("Two steps are both called 'work'. Give them different names so they can be told apart on the map.");
  });

  it("needs a name, steps, and an id and name on each step", () => {
    const f = base();
    delete f.name;
    expect(checkProcessFile(f).errors[0]).toMatch(/no name/);
    expect(checkProcessFile({ format: "transpera-process/1", name: "X", steps: [] }).errors[0]).toMatch(/no steps/);
    const g = base();
    delete g.steps[1].id;
    expect(checkProcessFile(g).errors).toContain("Step 'Work' has no id. Give each step a short unique id (like \"review\") so links can point at it.");
    const h = base();
    delete h.steps[1].name;
    expect(checkProcessFile(h).errors).toEqual(["Step 'b' has no name."]);
  });

  it("refuses links the editor wouldn't allow: out of an end step, into the start, to itself, twice", () => {
    const out = base();
    out.links.push({ from: "c", to: "b" });
    expect(checkProcessFile(out).errors).toEqual(["'Finish' is an end step, so nothing can follow it, but there is a link from it to 'Work'."]);
    const into = base();
    into.links.push({ from: "b", to: "a" });
    expect(checkProcessFile(into).errors).toEqual(["'Begin' is the start step, so nothing can lead into it, but 'Work' links to it."]);
    const self = base();
    self.links.push({ from: "b", to: "b" });
    expect(checkProcessFile(self).errors[0]).toMatch(/'Work' links to itself.*rework_rate/);
    const twice = base();
    twice.links.push({ from: "a", to: "b" });
    expect(checkProcessFile(twice).errors).toEqual(["'Begin' is linked to 'Work' twice."]);
  });

  it("refuses a loop with no decision in it, and accepts one that has a decision", () => {
    const f = base();
    f.steps.splice(2, 0, { id: "b2", name: "Check", type: "step" });
    f.links = [
      { from: "a", to: "b" },
      { from: "b", to: "b2" },
      { from: "b2", to: "b" },
      { from: "b2", to: "c" },
    ];
    expect(checkProcessFile(f).errors).toEqual(["'Work' → 'Check' → 'Work' goes round in a loop with nothing to decide when it stops. Add a decision step to the loop (with a branch that leaves it), or use rework_rate to send work back."]);
    f.steps[2].type = "decision";
    f.links[2].probability = 0.3;
    f.links[3].probability = 0.7;
    const ok = checkProcessFile(f);
    expect(ok.errors).toEqual([]);
    expect(ok.warnings).toEqual([]);
  });

  it("refuses more than one start step", () => {
    const f = base();
    f.steps.push({ id: "d", name: "Other start", type: "start" });
    f.links.push({ from: "d", to: "b" });
    expect(checkProcessFile(f).errors[0]).toMatch(/one start step, but this file has 2 \('Begin', 'Other start'\)/);
  });

  it("refuses numbers out of range and the wrong type of value", () => {
    const f = base();
    f.steps[1].rework_rate = 1.5;
    f.steps[1].hands_on_hours = "two";
    f.steps[1].type = "task";
    f.links[0].probability = 60;
    const { errors } = checkProcessFile(f);
    expect(errors).toContain("Step 'Work': rework_rate is 1.5, but it has to be between 0 and 1 (0.1 means one item in ten goes back).");
    expect(errors).toContain("Step 'Work': hands_on_hours should be a number (hours, like 0.25).");
    expect(errors).toContain("Step 'Work' has the type 'task', which Transpera doesn't know. Use step, decision, wait, start or end.");
    expect(errors).toContain("The link from 'Begin' to 'Work' has a probability that isn't a number from 0 to 1 (0.6 means 60%).");
  });

  it("checks groups: unknown steps, start and end steps, a step in two groups", () => {
    const f = example();
    f.groups = [
      { name: "Sales", steps: ["review", "nope", "enquiry"] },
      { name: "More", steps: ["review"] },
    ];
    const { errors } = checkProcessFile(f);
    expect(errors).toContain("Group 'Sales' lists 'nope', which isn't a step.");
    expect(errors).toContain("Group 'Sales' holds 'Enquiry arrives', but start and end steps stay outside groups.");
    expect(errors).toContain("'Review enquiry' is in two groups ('Sales' and 'More'); a step can be in one.");
  });
});

describe("warnings", () => {
  it("warns, and carries on, about fields it doesn't read (top level, step, link)", () => {
    const f = base();
    f.colour = "red";
    f.steps[1].owner = "Sam";
    f.links[0].weight = 3;
    const { file, errors, warnings } = checkProcessFile(f);
    expect(errors).toEqual([]);
    expect(file).not.toBeNull();
    expect(warnings).toEqual([
      "The file has a field 'colour' that Transpera doesn't use. It was ignored.",
      "Step 'Work' has a field 'owner' that Transpera doesn't use. It was ignored.",
      "The link from 'a' to 'b' has a field 'weight' that Transpera doesn't use. It was ignored.",
    ]);
  });

  it("warns when a decision's branches don't add up to 1", () => {
    const f = example();
    f.links[5].probability = 0.5;
    expect(checkProcessFile(f).warnings).toEqual(["Decision 'Client decides' branches add up to 0.9, not 1. The probabilities of the ways out of a step should add up to 1."]);
  });

  it("warns when given branches leave nothing for the ones without a number, but not when they leave room", () => {
    const f = example();
    f.links[5].probability = 0.7;
    delete f.links[6].probability;
    expect(checkProcessFile(f).warnings).toEqual([]);
    f.links[5].probability = 1;
    f.links.push({ from: "decides", to: "unqualified", probability: 0.5 });
    expect(checkProcessFile(f).warnings[0]).toMatch(/Decision 'Client decides' branches already add up to 1.5/);
  });

  it("uses the step nothing leads to as the start when there is no start step", () => {
    const f = base();
    f.steps[0].type = "step";
    const { file, warnings } = checkProcessFile(f);
    expect(warnings).toEqual(["No start step: 'Begin' will be used as the start."]);
    expect(file!.steps[0]!.type).toBe("start");
  });

  it("adds a start step in front when the first step is a decision or a wait", () => {
    const f = example();
    f.steps = f.steps.filter((s: { id: string }) => s.id !== "enquiry");
    f.links = f.links.filter((l: { from: string }) => l.from !== "enquiry");
    f.steps[0].type = "wait";
    const { file, warnings } = checkProcessFile(f);
    expect(warnings).toEqual(["No start step: a start step will be added in front of 'Review enquiry'."]);
    expect(file!.steps[0]).toEqual({ id: "start", name: "Start", type: "start" });
    expect(file!.links[0]).toEqual({ from: "start", to: "review" });
  });

  it("warns when there is no end step, and when nothing leaves a step", () => {
    const f = base();
    f.steps.pop();
    f.links.pop();
    const { errors, warnings } = checkProcessFile(f);
    expect(errors).toEqual([]);
    expect(warnings).toContain("No end step: nothing says how an item finishes. Add an end step (won, lost or done) for each way it can finish.");
    expect(warnings).toContain("Nothing leaves 'Work', so items stop there. Link it to the next step, or make it an end step.");
  });

  it("warns about a step that can't be reached from the start, and a start that leads to several steps", () => {
    const f = base();
    f.steps.push({ id: "d", name: "Orphan", type: "step" });
    f.links.push({ from: "d", to: "c" });
    f.links.push({ from: "a", to: "c", probability: 0.5 });
    f.links[0].probability = 0.5;
    const { warnings } = checkProcessFile(f);
    expect(warnings).toContain("'Orphan' can't be reached from the start step, so no item would ever get there.");
    expect(warnings).toContain("Start step 'Begin' leads to 2 steps; a start step should lead to just one.");
  });

  it("places a step automatically when only one of x and y is given", () => {
    const f = base();
    f.steps[1].x = 100;
    const { file, warnings } = checkProcessFile(f);
    expect(warnings).toEqual(["Step 'Work' has a position that isn't two numbers (x and y), so it will be placed automatically."]);
    expect(file!.steps[1]).not.toHaveProperty("x");
  });
});
