# PF.4 — Auth Token Routes

**VERDICT: MISSING — §5.5 must implement backend routes**

## Findings

| Route | Status | Notes |
|---|---|---|
| `POST /auth/tokens` | ❌ MISSING | Not in index.ts or openapi.ts |
| `GET /auth/tokens` | ❌ MISSING | Not in index.ts or openapi.ts |
| `DELETE /auth/tokens/:id` | ❌ MISSING | Not in index.ts or openapi.ts |

## Evidence

- `packages/daemon/src/index.ts` lines 216–277: route table includes `/auth/session` (line 220) but no `/auth/tokens` branch.
- `packages/daemon/src/openapi.ts` lines 4–45: no `/auth/tokens` path defined.
- `packages/db/src/schema.ts:377-387`: `auth_tokens` table EXISTS — DB storage is ready.

## Existing Auth Routes

- `POST /auth/session` — creates browser session + CSRF token (line 220)
- All routes go through `authenticate(ctx, url)` middleware (lines 218–219, 443–445)
- `/debug/events` requires `admin` scope (lines 313–318) — pattern for scope-gated routes

## Impact on §5.5

§5.5 must implement BOTH:
1. **Backend routes** in `packages/daemon/src/index.ts`:
   - `POST /auth/tokens` — issue token (write scope required to call; returns token once)
   - `GET /auth/tokens` — list tokens (read scope; returns fingerprint, not token value)
   - `DELETE /auth/tokens/:id` — revoke token (write scope)
2. **CLI wrappers** in `apps/cli/src/` for `auth issue/list/revoke`

## Scope Note

This is NOT a scope expansion — `local-daemon/spec.md` explicitly lists these routes in the CLI subcommand table. The backend routes are implied by the CLI spec. §5.5 owns both layers.
