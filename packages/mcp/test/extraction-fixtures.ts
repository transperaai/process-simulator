// The Tidewater dry run for the extraction skill (issue #27,
// .agents/skills/extract-process/SKILL.md): two invented interview
// transcripts, and the ordered tool calls a run of the skill makes on each
// (run-1.json, run-2.json). The tests replay them (postgrest-extraction.test.ts)
// and lint them against the transcripts (extraction-fixtures.test.ts).

import { readFileSync } from "node:fs";
import { EVIDENCE_COLUMNS } from "@transpera-flow/db";
import { TOOL_NAMES } from "../src/tools";

const DIR = new URL("../../../docs/extraction/examples/tidewater/", import.meta.url);

export interface RecordedCall {
  tool: string;
  arguments: Record<string, unknown>;
  /** Keep the new source's id under this name; later arguments refer to it as `$<name>`. */
  save?: string;
}

export interface Run {
  calls: RecordedCall[];
}

export const readFixture = (name: string): string => readFileSync(new URL(name, DIR), "utf8");
export const readRun = (name: string): Run => JSON.parse(readFixture(name)) as Run;

/** `$file:<name>` becomes that fixture's text; `$<key>` becomes a saved id (left as it is when none is given). */
export function substitute<T>(value: T, saved: Record<string, string> = {}): T {
  if (typeof value === "string") {
    if (value.startsWith("$file:")) return readFixture(value.slice("$file:".length)) as T;
    if (value.startsWith("$") && value.slice(1) in saved) return saved[value.slice(1)] as T;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, saved)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, saved)])) as T;
  return value;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

const SUGGESTION_TOOLS = ["set_company", "upsert_service", "upsert_person", "upsert_client", "set_demand"];
/** Tools the skill never calls: a person publishes, discards and logs issues. */
const NEVER = ["publish_process", "discard_draft", "log_issue"];
const DEFAULTS = /^(Server default|Given without a cited source)/;

interface Transcript {
  speakers: string[];
  body: string;
}

/**
 * Everything that must hold for a recorded run, as a list of problems (empty
 * when it is sound): tool names exist; every citation quotes its transcript
 * verbatim, from a listed speaker, at a timestamp that is on that line; every
 * number is cited or reasoned; a symmetric range cites its midpoint; every
 * suggestion carries evidence in the suggestion shape.
 */
export function lintRun(run: Run): string[] {
  const problems: string[] = [];
  const sources = new Map<string, Transcript>();
  let imports = 0;
  let adds = 0;

  const transcriptOf = (ref: unknown, where: string): Transcript | null => {
    const t = typeof ref === "string" ? sources.get(ref.replace(/^\$/, "")) : undefined;
    if (!t) problems.push(`${where}: the source ${JSON.stringify(ref)} was not added earlier in the run`);
    return t ?? null;
  };

  const checkQuote = (t: Transcript, c: Obj, where: string) => {
    const quote = String(c.quote ?? "");
    if (!quote.trim()) return problems.push(`${where}: empty quote`);
    if (!t.body.includes(quote)) return problems.push(`${where}: the quote is not in the transcript verbatim: ${JSON.stringify(quote)}`);
    const speaker = c.speaker;
    if (speaker !== undefined && (typeof speaker !== "string" || !t.speakers.includes(speaker))) problems.push(`${where}: speaker ${JSON.stringify(speaker)} is not one of the source's speakers`);
    if (typeof c.timestamp !== "string" || !t.body.includes(`[${c.timestamp}]`)) return problems.push(`${where}: timestamp ${JSON.stringify(c.timestamp)} is not in the transcript`);
    const line = t.body.split("\n").find((l) => l.startsWith(`[${c.timestamp}]`)) ?? "";
    if (!line.includes(quote)) problems.push(`${where}: the quote is not on the line at [${c.timestamp}]`);
    if (typeof speaker === "string" && !line.startsWith(`[${c.timestamp}] ${speaker}:`)) problems.push(`${where}: the line at [${c.timestamp}] is not spoken by ${speaker}`);
  };

  const lintSteps = (steps: Obj[], top: Obj[], isNew: boolean, t: Transcript | null) => {
    for (const s of steps) {
      const name = String(s.name);
      const where = `step '${name}'`;
      const kind = (s.kind as string | undefined) ?? "task";
      const cites = arr(s.evidence);
      const reasoned = new Set([...arr(s.assumptions), ...top.filter((a) => a.step === s.name)].map((a) => a.field));
      for (const a of [...arr(s.assumptions), ...top]) if (!String(a.reasoning ?? "").trim() || DEFAULTS.test(String(a.reasoning))) problems.push(`${where}: an assumption has no reasoning of its own`);
      for (const c of cites) {
        if (!(EVIDENCE_COLUMNS as readonly string[]).includes(String(c.field))) problems.push(`${where}: citation field ${JSON.stringify(c.field)} cannot cite evidence`);
        if (t) checkQuote(t, c, `${where} citation`);
        if (c.value === undefined || c.value === null) problems.push(`${where}: a citation without a value cannot conflict`);
      }
      const cited = (f: string) => cites.some((c) => c.field === f);
      const params = (p: "work" | "wait") => (isObj(s[`${p}_params`]) ? (s[`${p}_params`] as Obj) : null);
      const given = (f: string) => {
        const phase = f === "work_hours" ? "work" : f === "wait_hours" ? "wait" : null;
        return s[f] !== undefined || (phase !== null && s[`${phase}_dist`] === "triangular" && params(phase) !== null);
      };
      for (const f of EVIDENCE_COLUMNS) {
        if (given(f) && !cited(f) && !reasoned.has(f)) problems.push(`${where}: ${f} is given with neither a citation nor reasoning`);
        if ((f === "current_wip" || f === "sla_hours") && given(f) && !cited(f)) problems.push(`${where}: ${f} is stated only when a source states it`);
      }
      if (isNew) {
        const need = kind === "task" ? ["work_hours", "wait_hours", "rework_rate"] : kind === "wait" ? ["wait_hours"] : [];
        for (const f of need) if (!cited(f) && !reasoned.has(f)) problems.push(`${where}: ${f} would fall to the server default`);
      }
      for (const phase of ["work", "wait"] as const) {
        const p = params(phase);
        const c = cites.find((x) => x.field === `${phase}_hours`);
        if (s[`${phase}_dist`] === "triangular" && p && c && c.value !== undefined) {
          const mid = ((p.min as number) + (p.max as number)) / 2;
          if (p.mode !== mid || c.value !== mid) problems.push(`${where}: a triangular ${phase} range must cite its midpoint (min ${p.min}, mode ${p.mode}, max ${p.max}, value ${c.value})`);
        }
      }
      for (const key of ["work_hours", "wait_hours", "rework_rate", "sla_hours", "current_wip"]) {
        const v = s[key];
        if (typeof v === "number" && Math.round(v * 100) / 100 !== v) problems.push(`${where}: ${key} has more than 2 decimals`);
      }
    }
  };

  const lintEvidence = (list: unknown, where: string) => {
    const items = arr(list);
    if (!items.length) problems.push(`${where}: a suggestion needs evidence`);
    if (items.length > 20) problems.push(`${where}: at most 20 citations`);
    for (const e of items) {
      if ("field" in e) problems.push(`${where}: suggestion evidence has no field`);
      if ("speaker" in e && typeof e.speaker !== "string") problems.push(`${where}: speaker is left out, never null`);
      if (typeof e.timestamp === "string" && e.timestamp.length > 50) problems.push(`${where}: timestamp is at most 50 characters`);
      const t = transcriptOf(e.source_id, `${where} evidence`);
      if (t) checkQuote(t, e, `${where} evidence`);
    }
  };

  for (const [i, call] of run.calls.entries()) {
    const where = `call ${i + 1} (${call.tool})`;
    const args = call.arguments;
    if (!(TOOL_NAMES as readonly string[]).includes(call.tool)) problems.push(`${where}: no such tool`);
    if (NEVER.includes(call.tool)) problems.push(`${where}: the skill never calls this`);
    if (call.tool === "add_source") {
      adds++;
      const body = substitute(args.body) as string;
      const speakers = (args.speakers as string[] | undefined) ?? [];
      if (call.save) sources.set(call.save, { speakers, body });
      else problems.push(`${where}: save the source id so later calls can cite it`);
    }
    if (call.tool === "import_process") {
      imports++;
      const pj = args.process_json;
      if (!isObj(pj)) {
        problems.push(`${where}: process_json is an object`);
        continue;
      }
      const cited = arr(pj.steps).flatMap((s) => arr(s.evidence).map((c) => c.source));
      const t = transcriptOf(cited[0], where);
      if (new Set(cited).size > 1) problems.push(`${where}: one import is one interview, but it cites ${new Set(cited).size} sources`);
      lintSteps(arr(pj.steps), arr(pj.assumptions), args.target === undefined, t);
      if (pj.remove_missing) problems.push(`${where}: remove_missing stays at its default`);
    }
    if (SUGGESTION_TOOLS.includes(call.tool)) {
      if (call.tool === "set_demand") {
        for (const ls of arr(args.lead_sources)) lintEvidence(ls.evidence ?? args.evidence, `${where} lead source '${ls.name}'`);
        if (!args.lead_sources) lintEvidence(args.evidence, where);
      } else lintEvidence(args.evidence, where);
      if (!String(args.note ?? "").trim() && call.tool !== "set_demand") problems.push(`${where}: a suggestion carries a note with your reading`);
    }
  }
  if (imports !== adds) problems.push(`${imports} imports for ${adds} sources: one import per interview`);
  return problems;
}
