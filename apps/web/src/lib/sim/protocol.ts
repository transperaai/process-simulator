import type { EngineModel, SimulationResult } from "@transpera-flow/engine";

export interface SimRequest {
  id: number;
  model: EngineModel;
  reps: number;
  seed: number;
}

export type SimResponse =
  | { id: number; ok: true; result: SimulationResult; durationMs: number }
  | { id: number; ok: false; error: string };
