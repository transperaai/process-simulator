// First-principles tools (issue #119, A54; docs/research/first-principles.md Part B): get_first_principles and
// update_first_principles. Claude reads a transcript, then fills in or updates a process's first principles: the job,
// hard truths against assumptions, requirements with a named owner, delete candidates, what to simplify, accelerate
// and automate, the root cause and the success measures.
//
// Like every building tool, update_first_principles acts as the token's user through RLS and writes only into the
// process's draft, which it opens (or continues) with `open_draft`; the live version is never edited, and the
// database refuses it too (`edit_drafts_only`). The save is one compare-and-set on the row's `updated_at`, retried
// with the other person's answers merged in if someone saved first. The text it returns comes from the rule checks
// in packages/engine/src/first-principles.ts, never a language model.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadFirstPrinciples, loadProcessBundle, saveFirstPrinciples, type ProcessBundle } from "@transpera-flow/db";
import {
  countFilled,
  countFlags,
  emptyFirstPrinciples,
  firstPrinciplesFlags,
  FP_COMPARATORS,
  FP_KINDS,
  FP_STAGES,
  FP_VERDICTS,
  isAttention,
  stepsFilled,
  SUCCESS_KPI_FORM,
  type FirstPrinciples,
  type FpFlags,
  type SuccessKpi,
} from "@transpera-flow/engine";
import { beginEdit, header, writeError } from "./building-tools";
import { resolveProcess, resolveWorkspace, revisionIdFor, type ToolContext } from "./context";
import { mergeFirstPrinciples, type FpInput } from "./first-principles";
import { runTool, ToolError } from "./result";

export const FIRST_PRINCIPLES_TOOL_NAMES = ["get_first_principles", "update_first_principles"] as const;

const MAX_ATTEMPTS = 3;

const workspaceArg = z.string().optional().describe("Workspace id, slug or name. Defaults to the active workspace (set_active_workspace).");
const processArg = z.string().optional().describe("Process id or name. Defaults to the workspace's only process.");

const KPI_KEYS = Object.keys(SUCCESS_KPI_FORM) as [SuccessKpi, ...SuccessKpi[]];
const text = (max = 2000) => z.string().max(max);

const inputShape = {
  job: z
    .object({
      who: text().optional().describe("Who the process serves."),
      progress: text().optional().describe("The progress they are trying to make, in their words."),
      situation: text().optional().describe("The situation they are in when they come to you."),
      done: text().optional().describe("What done looks like for them."),
    })
    .strict()
    .optional()
    .describe("Step 1. Only the fields given change."),
  statements: z
    .array(
      z
        .object({
          text: z.string().trim().min(1).max(2000),
          kind: z.enum(FP_KINDS).optional().describe("truth (cannot be argued away: law, contract, hard capacity) or assumption (default)."),
          source: text().optional().describe("For a truth: where it comes from (a document, a setting, a transcript and time). A truth with no source is shown as an assumption."),
          test: text().optional().describe("For an assumption: one way to prove it wrong."),
        })
        .strict(),
    )
    .max(50)
    .optional()
    .describe("Step 2. Hard truths and assumptions."),
  requirements: z
    .array(
      z
        .object({
          text: z.string().trim().min(1).max(2000),
          owner: text(200).nullish().describe("The person who set the rule: a person's name (matched against People) or id. A team or department name is flagged; ask who in it set the rule."),
          why: text().optional().describe("Why the rule exists. 'We've always done it' is flagged as habit."),
          verdict: z.enum(FP_VERDICTS).optional().describe("keep, change, drop or challenge (default challenge)."),
          step: z.string().nullish().describe("The step the rule creates: id or name."),
        })
        .strict(),
    )
    .max(50)
    .optional()
    .describe("Step 3. Rules the process follows, each with a named owner."),
  deletes: z
    .array(
      z
        .object({
          step: z.string().min(1).describe("The step that might not need to exist: id or name."),
          breaks_if_removed: text().optional(),
          agreed_by: text(200).nullish().describe("The person who has to agree: name or id."),
          added_back: z.boolean().optional().describe("True once it was tried and put back."),
        })
        .strict(),
    )
    .max(50)
    .optional()
    .describe("Step 4. Steps that might go."),
  improvements: z
    .array(
      z
        .object({
          stage: z.enum(FP_STAGES).describe("simplify first, then accelerate, then automate."),
          text: z.string().trim().min(1).max(2000),
          step: z.string().nullish().describe("The step it changes: id or name. Accelerating or automating a delete candidate is flagged."),
        })
        .strict(),
    )
    .max(50)
    .optional()
    .describe("Step 5. Changes to the steps that stay."),
  why: z
    .object({
      problem: text().optional().describe("The biggest problem today."),
      chain: z.array(text()).max(10).optional().describe("The answers to 'why?', in order. Replaces the chain."),
      root: text().optional().describe("The root cause: something in the process, not a person."),
    })
    .strict()
    .optional()
    .describe("Step 6. The root cause."),
  measures: z
    .array(
      z
        .object({
          text: z.string().trim().min(1).max(2000),
          kpi: z
            .enum(KPI_KEYS)
            .nullish()
            .describe(
              "The number the simulation computes for it: " +
                KPI_KEYS.map((k) => `${k} (${SUCCESS_KPI_FORM[k].label}, ${SUCCESS_KPI_FORM[k].unit})`).join("; ") +
                ". Null or omitted when it can't be computed: it is then marked 'not checked by simulation'.",
            ),
          comparator: z.enum(FP_COMPARATORS).optional().describe("atLeast (default) or atMost."),
          target: z.number().nullish().describe("The target in the unit shown above: a win rate as a percentage (30 means 30%), time in working hours."),
          horizon: text(100).optional().describe("When it should be met, as written ('6 months')."),
        })
        .strict(),
    )
    .max(50)
    .optional()
    .describe("Step 7. How success is measured. Each measure with a simulation number gets a 'met in N% of runs' rating."),
};

const summarise = (fp: FirstPrinciples, flags: FpFlags) => ({
  steps_filled: countFilled(fp),
  filled: stepsFilled(fp),
  flag_count: countFlags(flags),
  flags: Object.fromEntries(Object.entries(flags).map(([k, list]) => [k, list.filter(isAttention).map((f) => ({ level: f.level, code: f.code, text: f.text }))])),
});

const contextOf = (bundle: Pick<ProcessBundle, "steps" | "people" | "roles">) => ({
  steps: bundle.steps.filter((s) => s.kind === "task" || s.kind === "wait" || s.kind === "decision" || s.kind === "subprocess").map((s) => ({ id: s.id, name: s.name })),
  people: bundle.people.map((p) => ({ id: p.id, name: p.name })),
  roles: bundle.roles.map((r) => ({ name: r.name })),
});

export function registerFirstPrinciplesTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "get_first_principles",
    {
      title: "Get first principles",
      description:
        "Read a process's first principles (the job, hard truths and assumptions, requirements and their owners, delete candidates, changes, root cause and success measures) " +
        "with what the rule checks flag. Reads the draft when there is one, else live. Read this before update_first_principles so you add to what is there.",
      inputSchema: {
        process: processArg,
        workspace: workspaceArg,
        revision: z.enum(["live", "draft"]).optional().describe("Which version to read (default: the draft if there is one, else live)."),
      },
    },
    (args) =>
      runTool(async (assumptions) => {
        const ws = await resolveWorkspace(ctx, args.workspace, assumptions);
        const proc = await resolveProcess(ctx, ws, args.process, assumptions);
        const revision = args.revision ?? (proc.draft_revision_id ? "draft" : "live");
        if (!args.revision) assumptions.push(`revision defaulted to ${revision}.`);
        const revisionId = revisionIdFor(proc, revision);
        const [bundle, stored] = await Promise.all([loadProcessBundle(ctx.db, ws, proc, revisionId), loadFirstPrinciples(ctx.db, proc.id, revisionId)]);
        const fp = stored.doc ?? emptyFirstPrinciples();
        const flags = firstPrinciplesFlags(fp, contextOf(bundle));
        return {
          workspace: { id: ws.id, name: ws.name },
          process: { id: proc.id, name: proc.name },
          revision: { id: revisionId, which: revision, number: bundle.revision.number },
          started: stored.doc !== null,
          inherited_from_version: stored.inheritedFrom,
          first_principles: fp,
          ...summarise(fp, flags),
          text: stored.doc
            ? `${countFilled(fp)} of 7 steps filled in for '${proc.name}' (${revision}), ${countFlags(flags)} flags.`
            : `'${proc.name}' has no first principles yet. update_first_principles starts them in the draft.`,
        };
      }),
  );

  server.registerTool(
    "update_first_principles",
    {
      title: "Update first principles",
      description:
        "Fill in or update a process's first principles from what you read in a transcript, writing to the process's draft (opened if there isn't one; live is never changed). " +
        "Give only the sections you have evidence for. mode 'merge' (default) adds new items, updates the ones it recognises by their text (or step) and removes nothing; " +
        "'replace' swaps each list you give for yours. Put where each truth comes from in its `source` (the transcript and time). Name a person, not a team, as a requirement's owner. " +
        "Returns the answers as stored and what the rule checks flag (owner is a team, speeding up a delete candidate, empty delete list, root cause that stops at a person, " +
        "success measure the simulation can't compute), so you can fix them or ask the person. Step and person names that don't match come back as warnings.",
      inputSchema: {
        ...inputShape,
        mode: z.enum(["merge", "replace"]).optional().describe("merge (default) or replace."),
        process: processArg,
        workspace: workspaceArg,
      },
    },
    (args) =>
      runTool(async (assumptions) => {
        if (!args.job && !args.statements && !args.requirements && !args.deletes && !args.improvements && !args.why && !args.measures) {
          throw new ToolError("invalid_input", "Give at least one of job, statements, requirements, deletes, improvements, why or measures.");
        }
        const mode = args.mode ?? "merge";
        if (!args.mode) assumptions.push("mode defaulted to merge: new items are added and matching ones updated; nothing is removed.");
        const editing = await beginEdit(ctx, args, assumptions);
        const lookup = contextOf(editing.bundle);
        const owner = { workspaceId: editing.ws.id, processId: editing.proc.id, revisionId: editing.draft.revision_id };
        const input: FpInput = { job: args.job, statements: args.statements, requirements: args.requirements, deletes: args.deletes, improvements: args.improvements, why: args.why, measures: args.measures };

        let stored = await loadFirstPrinciples(ctx.db, editing.proc.id, editing.draft.revision_id);
        let merged = mergeFirstPrinciples(stored.doc ?? emptyFirstPrinciples(), input, lookup, mode);
        for (let attempt = 1; ; attempt++) {
          // Nothing to change in a row that already exists: no write, no audit entry.
          if (merged.changed.length === 0 && stored.version !== null) break;
          const outcome = await saveFirstPrinciples(ctx.db, owner, merged.doc, stored.version);
          if (outcome.status === "saved") break;
          if (outcome.status === "forbidden") throw new ToolError("forbidden", `You don't have permission to change first principles in '${editing.ws.name}' (editors and owners can).`);
          if (outcome.status === "not_draft") throw writeError({ code: "55000" }, "change first principles");
          if (outcome.status === "invalid") throw new ToolError("invalid_input", outcome.message);
          if (outcome.status === "error") throw new ToolError("write_failed", outcome.message);
          // Someone saved first: merge onto their answers and try again.
          if (attempt >= MAX_ATTEMPTS) throw new ToolError("conflict", "Someone else keeps changing these first principles; try again in a moment.");
          stored = { doc: outcome.doc, version: outcome.version, inheritedFrom: null };
          merged = mergeFirstPrinciples(outcome.doc, input, lookup, mode);
        }

        const flags = firstPrinciplesFlags(merged.doc, lookup);
        const summary = summarise(merged.doc, flags);
        return {
          ...header(editing),
          changed: merged.changed,
          warnings: merged.warnings,
          first_principles: merged.doc,
          ...summary,
          text:
            `${merged.changed.length ? `Updated ${merged.changed.length} of 7 steps` : "Nothing changed"} in the draft of '${editing.proc.name}'. ` +
            `${summary.steps_filled} of 7 steps are filled in and ${summary.flag_count} ${summary.flag_count === 1 ? "flag needs" : "flags need"} a look` +
            `${merged.warnings.length ? `; ${merged.warnings.length} ${merged.warnings.length === 1 ? "name" : "names"} couldn't be placed` : ""}. ` +
            "The live version is unchanged until the draft is published.",
        };
      }),
  );
}
