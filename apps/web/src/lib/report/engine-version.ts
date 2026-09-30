// The engine version a report's run records (`runs.engine_version`). Issue
// #22 versions the engine (golden snapshots bump it); until it lands, runs
// made for a report record this placeholder, so they can be told apart from
// versioned ones later. Replace it with the engine's own constant then.
export const REPORT_ENGINE_VERSION = "0.0.0-unversioned";
