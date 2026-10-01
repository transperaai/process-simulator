"use client";

import { useMemo } from "react";
import { successMeasureSource, type FirstPrinciples, type SuccessMeasureSource } from "@transpera-flow/engine";
import { useDemoFirstPrinciples } from "./demo-store";

/**
 * The success measures a process's first principles name, as rule 11 (goals met) reads them (issue #119). Every page
 * that rates a run passes this to the detectors, so they all agree: a workspace passes its live version's answers
 * (loaded with the page), the demo reads the answers edited in this tab. Undefined, rating nothing, when there are none.
 */
export function useSuccessMeasures(processId: string, demo: boolean, doc: FirstPrinciples | null | undefined): SuccessMeasureSource | undefined {
  const inTab = useDemoFirstPrinciples(processId);
  const answers = demo ? inTab : (doc ?? null);
  return useMemo(() => (answers ? successMeasureSource(answers, processId) : undefined), [answers, processId]);
}
