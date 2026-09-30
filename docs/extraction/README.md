# Extracting a process from interview transcripts

Turn recorded audit interviews into a draft process with cited evidence, using Claude and the Transpera Flow MCP server. Product background: `docs/PRD.md` §7.1b (intake and drafts) and §7.2 (the extraction prompt).

The prompt is a skill: [`.agents/skills/extract-process/SKILL.md`](../../.agents/skills/extract-process/SKILL.md), reachable as `.claude/skills/extract-process`. It is user-invoked only. It ends at a draft and pending suggestions; you publish from the canvas.

## Connect

1. Create a token at `/settings/tokens` (the "API tokens" page). It is shown once.
2. Claude Code:
   ```sh
   claude mcp add --transport http transpera-flow https://<host>/api/mcp \
     --header "Authorization: Bearer tf_…"
   ```
3. Claude desktop. Custom connectors that expect OAuth do not fit a bearer token, so bridge with `mcp-remote` in `claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "transpera-flow": {
         "command": "npx",
         "args": ["-y", "mcp-remote", "https://<host>/api/mcp", "--header", "Authorization:${TF_AUTH}"],
         "env": { "TF_AUTH": "Bearer tf_…" }
       }
     }
   }
   ```
   The shape follows the `mcp-remote` README (no space after the colon, the token in `env`, because some desktop clients mangle spaces in `args`). **Verify on first use**: it has not been tried against this server. The endpoint accepts POST only (a GET answers 405), which is expected.

## Load the prompt

- Claude Code inside this repo: type `/extract-process`.
- Claude Code elsewhere: link the skill once, `ln -s <repo>/.agents/skills/extract-process ~/.claude/skills/extract-process`.
- Claude desktop: create a Project and paste the body of `SKILL.md` (everything after the frontmatter) into its instructions, or upload the skill folder if your account supports custom skills.

## Run it on a transcript

1. Attach or paste the transcript, and say which workspace it belongs to.
2. Answer the questions it asks (workspace, new process or an existing one).
3. Read its summary: conflicts, assumptions, suggestions, open questions, timing notes and a ledger of every number heard.
4. In the app: the canvas checklist rail (conflicts first), confirm or override each value, accept or reject on the workspace's Suggestions page, then Publish.

## A second interview

Same conversation or a new one; tell it the process name. Expect `created: false` and a diff against live, so publish after the first interview to make the diff meaningful. Speakers who disagree become a range and a conflict on the step while the value is still an estimate. A value someone confirmed on the canvas is kept: the new one is flagged as a conflict and no range is built.

## Troubleshooting

| Error code | Meaning |
|---|---|
| `ambiguous` | A name matched several rows; the reply lists `candidates`. Pass the exact name or id. |
| `not_found` | Roles, services and people must already exist: no tool creates a role, and a person or client that is only a pending suggestion cannot be referenced yet. |
| `name_taken` | A process or step of that name exists; import with `target`, or use `update_step`. |
| `forbidden` | The token's user needs the editor role in the workspace. |
| `unresolved` | Publishing is refused while assumptions or conflicts remain. Publishing is a human step. |

## Known limits

- Routing has no evidence: a routing disagreement cannot become a conflict in the app, and the summary reports it as untracked.
- A range cited without a value cannot conflict. The skill cites the midpoint of a symmetric hedge as the value.
- `get_workspace_summary` lists no clients, services or lead sources, and there is no list of sources.
- Servicing links and their SLAs are set in Settings; MCP cannot set them.
- A servicing process alone cannot be simulated (`run_scenario` answers `invalid_model`), so cycle times cannot be checked until a pipeline exists beside it.

## Examples and QA

- `docs/extraction/examples/tidewater`: a solved dry run on invented interviews, replayed by the test suite.
- `docs/extraction/qa`: the timed QA pack for issue #27 (see its `README.md`).
