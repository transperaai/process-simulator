"use client";

// Runs the automatic verdict in a Web Worker so the Editor stays responsive (issue #114). One worker per call, ended when it answers
// or when the caller cancels.

import type { VerdictRequest, VerdictResponse } from "@/workers/verdict.worker";
import type { TargetVerdict } from "./verdict";

export function verdictInWorker(request: VerdictRequest): { promise: Promise<TargetVerdict>; cancel: () => void } {
  const worker = new Worker(new URL("../../workers/verdict.worker.ts", import.meta.url), { type: "module" });
  let rejectIt: (e: Error) => void = () => undefined;
  const promise = new Promise<TargetVerdict>((resolve, reject) => {
    rejectIt = reject;
    worker.onmessage = (e: MessageEvent<VerdictResponse>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.verdict);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "The verdict worker failed"));
    };
    worker.postMessage(request);
  });
  return {
    promise,
    cancel: () => {
      worker.terminate();
      rejectIt(new Error("cancelled"));
    },
  };
}
