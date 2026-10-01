import "server-only";
import { after } from "next/server";
import type { Db } from "@transpera-flow/db";
import { runAiAnalysis, runAiAnalysisAfterMarketChange, runInBackground } from "./service";

// The automatic triggers of AI analysis (issue #111, A46): a version is published, or the market conditions change.
// Each is handed to `after()`, so it starts once the response has gone: the person who published or edited never waits
// for it, and a failure (no API key, a refusal, a timeout) never reaches them. The switches (Settings -> AI analysis)
// and the no-key case are checked inside the run, so a trigger can always be called.

/** After a publish has succeeded: review the version that just went live, as the user who published it. */
export function afterPublish(db: Db, processId: string): void {
  after(() => runInBackground(() => runAiAnalysis(db, processId, { trigger: "publish" })));
}

/** After the market conditions or their schedule changed: review the workspace's live processes again. */
export function afterMarketChange(db: Db, workspaceId: string): void {
  after(() => runInBackground(() => runAiAnalysisAfterMarketChange(db, workspaceId)));
}
