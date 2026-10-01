"use client";

// The Editor's left column (issue #104): the step palette (adds after the selected step, inside its group if it is in
// one), grouping, and a place for blocks (the block library, A51).

import type { Dispatch, SetStateAction } from "react";
import { isGroup, type ProcessBundle } from "@transpera-flow/db";
import { Help } from "@/components/help";
import { Button } from "@/components/ui/button";
import type { Selection } from "@/components/process-canvas";
import type { ProcessEditor } from "@/lib/editor/editor";
import { addAfter, groupProblem, groupSteps, ungroup, type PaletteKind } from "@/lib/editor/groups";

const PALETTE: { kind: PaletteKind; label: string }[] = [
  { kind: "task", label: "+ Step" },
  { kind: "decision", label: "+ Decision" },
  { kind: "wait", label: "+ Wait" },
  { kind: "group", label: "+ Group" },
];

export function Palette({
  bundle,
  editor,
  selected,
  setSelection,
}: {
  bundle: ProcessBundle;
  editor: ProcessEditor;
  selected: Selection;
  setSelection: Dispatch<SetStateAction<Selection>>;
}) {
  const only = selected.steps.length === 1 ? bundle.steps.find((s) => s.id === selected.steps[0]) : undefined;
  const add = (kind: PaletteKind) => {
    let id: string | null = null;
    editor.run((b) => {
      const made = addAfter(b, only?.id ?? null, kind);
      id = made.id;
      return made.edit;
    });
    if (id) setSelection({ steps: [id], edges: [] });
  };
  const groupWhy = groupProblem(bundle, selected.steps);
  const group = () => {
    let id: string | null = null;
    editor.run((b) => {
      const made = groupSteps(b, selected.steps);
      id = made?.id ?? null;
      return made?.edit ?? null;
    });
    if (id) setSelection({ steps: [id], edges: [] });
  };
  const ungroupWhy = only && isGroup(only) ? null : "Select a group to take its steps back out.";
  const dissolve = () => {
    if (!only) return;
    // Its steps stay where they are, so keep the first of them selected.
    const first = bundle.steps.find((s) => s.parent_step_id === only.id);
    if (editor.run((b) => ungroup(b, only.id))) setSelection({ steps: first ? [first.id] : [], edges: [] });
  };

  return (
    <>
      <section aria-label="Add to the process" className="flex flex-col gap-2">
        <h2 className="flex items-center text-[11px] font-semibold tracking-wider text-fg-2 uppercase">
          Add
          <Help
            label="Add"
            description="Adds a new step, decision, wait or group right after the step you have selected, inside the same group if it is in one. Nothing selected adds it at the end."
            example="Select “Discovery call”, press + Wait, and a waiting step appears after it, joined in."
          />
        </h2>
        <div className="grid grid-cols-2 gap-1.5">
          {PALETTE.map(({ kind, label }) => (
            <Button key={kind} type="button" variant="outline" size="sm" onClick={() => add(kind)} className="border-dashed hover:border-edit">
              {label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{only ? `Adds after ${only.name}.` : "Adds after the selected step."}</p>
      </section>

      <section aria-label="Groups" className="flex flex-col gap-2">
        <h2 className="flex items-center text-[11px] font-semibold tracking-wider text-fg-2 uppercase">
          Groups
          <Help
            label="Groups"
            description="A group is a box that holds several steps so a big process stays readable. The numbers are the same whether it is open or closed."
            example="Put “Qualify lead” and “Discovery call” in one group called “Sales conversation”."
          />
        </h2>
        <Button type="button" variant="outline" size="sm" disabled={!!groupWhy} title={groupWhy ?? undefined} onClick={group}>
          Group selected steps
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!!ungroupWhy} title={ungroupWhy ?? undefined} onClick={dissolve}>
          Ungroup
        </Button>
        <p className="text-xs text-muted-foreground">
          {groupWhy && selected.steps.length ? groupWhy : "Shift-click or drag a box on the map to select several steps."}
        </p>
      </section>

      <section aria-label="Blocks" className="flex flex-col gap-2">
        <h2 className="flex items-center text-[11px] font-semibold tracking-wider text-fg-2 uppercase">
          Blocks
          <Help
            label="Blocks"
            description="A block is a saved group of steps you can drop into any process, such as a standard approval or an AI check."
            example="Save your “Client sign-off” group once, then insert it into every onboarding process."
          />
        </h2>
        <p className="text-xs text-muted-foreground">Saved blocks will show here, to insert or to replace the selected group.</p>
      </section>
    </>
  );
}
