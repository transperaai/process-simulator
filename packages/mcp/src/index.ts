// MCP server (docs/PRD.md §7.1). The HTTP endpoint lives in the web app
// (apps/web/src/app/api/mcp/route.ts) and delegates to handleMcpRequest.
export { API_TOKEN_HEADER, handleMcpRequest, type McpHandlerOptions } from "./handler";
export { assertPublishableKey } from "./key-guard";
export { ToolError, type ToolPayload } from "./result";
export { generateApiToken, hashApiToken, looksLikeApiToken } from "./tokens";
export { applyOverrides, createMcpServer, DEFAULT_REPS, DEFAULT_SEED, summarizeRun, TOOL_NAMES } from "./tools";
export { ANALYSIS_TOOL_NAMES, DEFAULT_ROBUSTNESS_SECONDS, MAX_ROBUSTNESS_SECONDS } from "./analysis-tools";
export { bottleneckReport, checkScenarioRobustness, compareScenarios, matchNamed, robustnessParameters, stackPatches, type NamedScenario } from "./analysis";
export { BUILDING_TOOL_NAMES } from "./building-tools";
export { buildNewStep, buildStepChange, planImport, resolveName, revisionDiff, type ImportInput, type ImportPlan, type RevisionDiff, type StepFields } from "./building";
export { PROCESS_TEMPLATES, type ProcessTemplate } from "./templates";
