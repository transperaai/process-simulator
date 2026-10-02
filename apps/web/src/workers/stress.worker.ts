/// <reference lib="webworker" />
// The market stress test, off the main thread (issue #115, A50 slice 2): each condition is simulated for the version the solution was
// copied from and for the solution, and each row is posted as soon as it is done, so the table fills in while the rest still runs.
import { runStress, type StressMessage, type StressRequest } from "@/lib/solutions/stress";

self.onmessage = (event: MessageEvent<StressRequest>) => {
  const req = event.data;
  try {
    runStress(req, (row) => self.postMessage({ id: req.id, kind: "row", row } satisfies StressMessage));
    self.postMessage({ id: req.id, kind: "done" } satisfies StressMessage);
  } catch (err) {
    self.postMessage({ id: req.id, kind: "error", error: err instanceof Error ? err.message : String(err) } satisfies StressMessage);
  }
};
