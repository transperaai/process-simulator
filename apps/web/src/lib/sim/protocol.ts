import type { EngineModel, SimulationResult } from "@flowsim/engine";

export interface SimRequest {
  id: number;
  model: EngineModel;
  reps: number;
  seed: number;
}

export type SimResponse =
  | { id: number; ok: true; result: SimulationResult; durationMs: number }
  | { id: number; ok: false; error: string };
