// Which steps belong to the process on a process page: its own and those of the processes inside it. The model can
// hold more (a servicing process runs beside the pipeline), so the page's wait chart, insights and issues keep to these.

import type { ProcessBundle, StepRow } from "@transpera-flow/db";

/** The steps of the bundle's process and of every process nested inside it, any depth. */
export function processSteps(bundle: ProcessBundle): StepRow[] {
  const others = bundle.otherProcesses ?? [];
  const inside = new Set([bundle.process.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const o of others) {
      const parent = o.process.parent_process_id;
      if (!inside.has(o.process.id) && parent && inside.has(parent)) {
        inside.add(o.process.id);
        grew = true;
      }
    }
  }
  return [...bundle.steps, ...others.filter((o) => inside.has(o.process.id)).flatMap((o) => o.steps)];
}

export const processStepIds = (bundle: ProcessBundle): Set<string> => new Set(processSteps(bundle).map((s) => s.id));
