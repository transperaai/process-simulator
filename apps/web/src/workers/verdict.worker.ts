/// <reference lib="webworker" />
// The automatic verdict, off the main thread (issue #114): it re-simulates the model (30 runs, seed 1, as the Editor's compare does)
// and re-runs each run for the per-step numbers, which together take about as long as two simulations.
import { simulate, type EngineModel } from "@transpera-flow/engine";
import { checkTarget, type TargetVerdict } from "@/lib/solutions/verdict";

export interface VerdictRequest {
  target: { measure: string | null; goal: string | null };
  model: EngineModel;
  area: string[];
}
export type VerdictResponse = { ok: true; verdict: TargetVerdict } | { ok: false; error: string };

self.onmessage = (event: MessageEvent<VerdictRequest>) => {
  const { target, model, area } = event.data;
  let response: VerdictResponse;
  try {
    response = { ok: true, verdict: checkTarget({ target, model, result: simulate(model, 30, 1), area }) };
  } catch (err) {
    response = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(response);
};
