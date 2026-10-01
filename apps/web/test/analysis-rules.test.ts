import { describe, expect, it } from "vitest";
import { ANALYSIS_RULE_IDS, absenceTest, ANALYSIS_RULE_SPECS, detectIssues, northbeamModel, northbeamWithServicing, simulate, type AnalysisSettings } from "@transpera-flow/engine";
import { RULES_UI, bandsOf, fromDisplay, toDisplay } from "@/lib/rules/catalogue";
import { addOverride, removeOverride, rerate, resetAll, resetRule, ruleOfIssue, setEscalator, setMoney, setRuleEnabled, setRuleInputs, tally, visibleFindings } from "@/lib/rules/edit";

// Settings -> Analysis rules (issue #109): how each rule reads, editing the document, and re-rating a run.

describe("the screen's wording covers every rule", () => {
  it("has a plain name, a description, an example and one box per cut-off for each of the 15 rules", () => {
    expect(ANALYSIS_RULE_IDS).toHaveLength(15);
    for (const id of ANALYSIS_RULE_IDS) {
      const ui = RULES_UI[id];
      expect(ui.name, id).toBeTruthy();
      expect(ui.help.description.length, id).toBeGreaterThan(10);
      expect(ui.help.example.length, id).toBeGreaterThan(10);
      expect(ui.inputs, id).toHaveLength(ANALYSIS_RULE_SPECS[id].defaults.length);
    }
  });

  it("uses the prototype's names", () => {
    expect(["busy", "wait", "sla", "spof"].map((id) => RULES_UI[id as keyof typeof RULES_UI].name)).toEqual([
      "Too busy",
      "Waiting too long",
      "Missed deadlines",
      "Only one person can do it",
    ]);
  });

  it("reads the default bands as the spec's table does", () => {
    const d = (id: (typeof ANALYSIS_RULE_IDS)[number]) => bandsOf(id, ANALYSIS_RULE_SPECS[id].defaults);
    expect(d("busy")).toEqual(["under 70%", "70–85%", "85–95%", "over 95%"]);
    expect(d("wait")).toEqual(["within 1×", "up to 1.5×", "up to 3×", "over 3×"]);
    expect(d("rework")).toEqual(["under 5%", "5–10%", "10–20%", "over 20%"]);
    expect(d("sla")).toEqual(["under 5%", "5–10%", "10–25%", "over 25%"]);
    expect(d("queue")).toEqual(["", "", "", "0.5+ items a week"]);
    expect(d("health")).toEqual(["75+", "65–75", "50–65", "under 50"]);
    expect(d("dropoff")).toEqual(["at or better", "up to 1.25×", "up to 1.5×", "over 1.5×"]);
  });

  it("previews the bands as cut-offs change", () => {
    expect(bandsOf("busy", [0.6, 0.8, 0.9])).toEqual(["under 60%", "60–80%", "80–90%", "over 90%"]);
  });

  it("turns boxes into stored numbers and back without drifting", () => {
    expect(fromDisplay("busy", [70, 85, 95])).toEqual([0.7, 0.85, 0.95]);
    expect(toDisplay("busy", [0.7, 0.85, 0.95])).toEqual([70, 85, 95]);
    expect(fromDisplay("health", [75, 65, 50])).toEqual([75, 65, 50]);
    for (const id of ANALYSIS_RULE_IDS) {
      const d = ANALYSIS_RULE_SPECS[id].defaults;
      expect(fromDisplay(id, toDisplay(id, d))).toEqual([...d]);
    }
  });
});

describe("editing the document", () => {
  it("switches a rule off and on again; on again leaves nothing stored", () => {
    const off = setRuleEnabled({}, "busy", false);
    expect(off).toEqual({ rules: { busy: { enabled: false } } });
    expect(setRuleEnabled(off, "busy", true)).toEqual({});
  });

  it("stores cut-offs that differ and refuses ones that aren't allowed", () => {
    const next = setRuleInputs({}, "busy", [0.6, 0.8, 0.9]);
    expect(next.rules?.busy?.inputs).toEqual([0.6, 0.8, 0.9]);
    expect(setRuleInputs(next, "busy", [0.9, 0.8, 0.95])).toBe(next);
    expect(setRuleInputs(next, "busy", [0.7, 0.85, 0.95])).toEqual({});
  });

  it("resets one rule, or everything", () => {
    const s: AnalysisSettings = {
      rules: { busy: { inputs: [0.6, 0.8, 0.9], overrides: [{ kind: "role", id: "r", enabled: false }] }, rework: { enabled: false } },
      escalators: { badMonth: false },
      money: { capMonths: 6 },
    };
    expect(resetRule(s, "busy")).toEqual({ rules: { rework: { enabled: false } }, escalators: { badMonth: false }, money: { capMonths: 6 } });
    expect(resetAll()).toEqual({});
  });

  it("adds an override, replaces one for the same subject, and removes it", () => {
    const a = addOverride({}, "busy", { kind: "person", id: "p1", label: "Maya", inputs: [0.6, 0.75, 0.9] });
    const b = addOverride(a, "busy", { kind: "person", id: "p1", label: "Maya", inputs: [0.5, 0.7, 0.9] });
    const c = addOverride(b, "busy", { kind: "role", id: "r1", enabled: false });
    expect(c.rules?.busy?.overrides?.map((o) => `${o.kind}:${o.id}`)).toEqual(["person:p1", "role:r1"]);
    expect(c.rules?.busy?.overrides?.[0]?.inputs).toEqual([0.5, 0.7, 0.9]);
    expect(removeOverride(removeOverride(c, "busy", "person", "p1"), "busy", "role", "r1")).toEqual({});
  });

  it("switches the escalators and sets the money settings", () => {
    expect(setEscalator({}, "bottleneck", false)).toEqual({ escalators: { bottleneck: false } });
    expect(setEscalator({ escalators: { bottleneck: false } }, "bottleneck", true)).toEqual({});
    expect(setMoney({}, { capMonths: 6, absenceWeeks: 3 })).toEqual({ money: { capMonths: 6, absenceWeeks: 3 } });
    expect(setMoney({ money: { capMonths: 6 } }, { capMonths: undefined })).toEqual({});
    expect(setMoney({}, { waitHours: { pipeline: 4 } })).toEqual({ money: { waitHours: { pipeline: 4 } } });
    expect(setMoney({ money: { waitHours: { pipeline: 4 } } }, { waitHours: { servicing: 24 } }).money?.waitHours).toEqual({ pipeline: 4, servicing: 24 });
  });
});

describe("re-rating the latest run", () => {
  // Northbeam as the engine ships it: one simulation, many ratings.
  const model = northbeamModel();
  const result = simulate(model, 8, 1);

  it("matches the engine's default rating with no settings", () => {
    const base = rerate(model, result, {});
    expect(base.length).toBeGreaterThan(0);
    expect(base).toEqual(detectIssues(model, result));
  });

  it("moves ratings when a cut-off changes, with no further simulation", () => {
    const base = tally(rerate(model, result, {}));
    // Switch every rating-model rule off: those findings go; the legacy detectors' findings stay.
    let off: AnalysisSettings = {};
    for (const id of ["busy", "overtime", "queue", "wait", "rework", "sla"] as const) off = setRuleEnabled(off, id, false);
    const none = tally(rerate(model, result, off));
    expect(Object.values(none.byRule).reduce((a, b) => a + (b ?? 0), 0)).toBe(0);
    expect(none.total).toBeLessThan(base.total);
    // A stricter busy rule can only add busy findings or raise them.
    const strict = tally(rerate(model, result, setRuleInputs({}, "busy", [0.1, 0.2, 0.3])));
    expect(strict.byRule.busy ?? 0).toBeGreaterThanOrEqual(base.byRule.busy ?? 0);
  });

  it("takes the run it is given and leaves it as it was, so one run serves every set of rules", () => {
    const before = JSON.stringify(result);
    const a = rerate(model, result, setRuleEnabled({}, "wait", false));
    const b = rerate(model, result, {});
    expect(JSON.stringify(result)).toBe(before);
    expect(a.some((i) => i.key.startsWith("wait:"))).toBe(false);
    expect(b.length).toBeGreaterThanOrEqual(a.length);
  });

  it("maps a finding to its rule", () => {
    expect(ruleOfIssue({ key: "capacity:role:r" })).toBe("busy");
    expect(ruleOfIssue({ key: "wait:step:a" })).toBe("wait");
    expect(ruleOfIssue({ key: "spof:step:a" })).toBe("spof");
    expect(ruleOfIssue({ key: "spare:person:a" })).toBe("spare");
  });
});

describe("switching off a rule whose detector already runs", () => {
  // Northbeam with servicing has one-person steps and client churn risks.
  const model = northbeamWithServicing();
  const result = simulate(model, 8, 1);
  const all = rerate(model, result, {}, null, absenceTest(model));
  const keys = (list: { key: string }[], prefix: string) => list.filter((i) => i.key.startsWith(prefix));

  it("removes spof findings when Only one person can do it is off, and keeps the rest", () => {
    const off = visibleFindings(setRuleEnabled({}, "spof", false), all);
    expect(keys(all, "spof:").length).toBeGreaterThan(0);
    expect(keys(off, "spof:")).toEqual([]);
    expect(off.length).toBe(all.length - keys(all, "spof:").length);
  });

  it("removes churn findings when Client health is off, broken solutions and perception gaps with theirs", () => {
    const churn = [{ key: "churn_risk:client:c1", type: "churn_risk" }] as never[];
    expect(visibleFindings(setRuleEnabled({}, "health", false), churn)).toEqual([]);
    expect(visibleFindings({}, churn)).toHaveLength(1);
    const extra = [
      { key: "broken_scenario:scenario:x", type: "broken_scenario" },
      { key: "perception_gap:step:y", type: "perception_gap" },
    ] as never[];
    expect(visibleFindings(setRuleEnabled({}, "broken", false), extra)).toHaveLength(1);
    expect(visibleFindings(setRuleEnabled(setRuleEnabled({}, "broken", false), "sources", false), extra)).toHaveLength(0);
    expect(visibleFindings({}, extra)).toHaveLength(2);
  });
});
