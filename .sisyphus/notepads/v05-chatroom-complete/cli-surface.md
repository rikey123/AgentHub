# PF.7 CLI Surface Map

## Current CLI commands/subcommands
- `agenthub status [--url URL]` ！ queries `AgentHubClient.health()` and prints JSON.
- `agenthub mock solo [--message TEXT]` ！ boots an ephemeral daemon, creates a solo room, sends a message, prints `{ roomId, messages }`.
- `agenthub permissions profiles` ！ prints `listPermissionProfiles()` JSON.
- `agenthub permissions requests [--status STATUS] [--room ID]` ！ prints `listPermissionRequests()` JSON.
- `agenthub permissions resolve REQUEST_ID --decision allow|deny [--scope SCOPE] [--remember]` ！ resolves a permission request.
- `agenthub context list [--workspace ID] [--status STATUS]` ！ prints `listContext()` JSON.
- `agenthub interventions list [--room ID] [--status STATUS]` ！ prints `listInterventions()` JSON.
- `agenthub artifacts list [--room ID] [--status STATUS]` ！ prints `listArtifacts()` JSON.
- `agenthub debug stats` ！ prints `debugStats()` JSON.
- Fallback usage string only; no help parser / no shared command registry.

## File structure
- `apps/cli/src/index.ts` is a single monolithic CLI entrypoint.
- `apps/cli/src/` currently contains only `index.ts`.
- No `commands/` submodules exist yet.

## Existing CLI tests
- `apps/cli/test/cli.test.ts`
  - smoke test for `mock solo`
  - smoke test for `permissions profiles`
  - combined test for `interventions list` and `debug stats`
- Coverage gaps:
  - no direct tests for `status`
  - no direct tests for `context list`
  - no direct tests for `permissions requests` or `permissions resolve`
  - no direct tests for `artifacts list`
  - no assertions on usage/error text

## Recommendation
- Split before adding V0.5 commands.
- Create `apps/cli/src/commands/{agents,daemon,auth}.ts` (or equivalent) and keep `index.ts` as a thin dispatcher.
- Reason: current CLI is still small, but the next wave (`agents reset`, `start/stop/status/doctor`, `auth issue/list/revoke`) crosses multiple command families and will make the monolith harder to merge safely.

## Collision plan
- `′3.4` (`agents reset`) and `′5.5` (`start/stop/status/doctor/auth*`) both touch the CLI surface.
- Recommended order: **serialize changes**; land `′3.4` first, then `′5.5`.
- If modularization happens first, do it as a dedicated prep change so both feature branches can add only to their own command module files and avoid `index.ts` conflicts.
