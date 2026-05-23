# Final Playwright Golden Verification - F3

Date: 2026-05-23
Verdict: APPROVE

## Coverage inspected
- Active E2E files in `apps/web/e2e`: `main-detail-projection.spec.ts`, `pending-turn.spec.ts`, `test-server.ts`.
- No `golden-path.spec.ts` exists; this is non-blocking because current equivalent specs cover the requested MVP browser flows.
- `main-detail-projection.spec.ts` includes actual browser UI mutation coverage: clicks `New Room`, fills the textarea, clicks `Send`, waits for the sent text, and asserts mutating `/rooms` and `/rooms/{id}/messages` requests include `X-Agenthub-CSRF` and JSON content type.
- `main-detail-projection.spec.ts` covers Run Detail opening from the side panel and all 7 tabs: transcript, tools, context, permissions, artifacts, raw, cost.
- `pending-turn.spec.ts` covers PendingTurn queue UI by verifying the queue-limit banner and disabled/full textarea placeholder at 20 queued messages.

## Commands run

### Web production build
```powershell
pnpm.cmd --filter @agenthub/web build
```
Result: PASS
Key output:
```text
> @agenthub/web@0.0.0 build C:\project\AgentHub\apps\web
> tsc && vite build
vite v6.4.2 building for production...
✓ 651 modules transformed.
✓ built in 3.19s
```

### Browser E2E tests
```powershell
pnpm.cmd exec playwright test apps/web/e2e/main-detail-projection.spec.ts apps/web/e2e/pending-turn.spec.ts
```
Result: PASS
Key output:
```text
Running 4 tests using 2 workers
ok 1 apps\web\e2e\pending-turn.spec.ts:31:3 › pending turn UI › queue limit banner appears at 20 messages (3.3s)
ok 2 apps\web\e2e\main-detail-projection.spec.ts:31:3 › main timeline and run detail projection › main timeline shows messages and hides tool details (3.4s)
ok 3 apps\web\e2e\main-detail-projection.spec.ts:55:3 › main timeline and run detail projection › browser UI bootstraps auth session and sends CSRF on room/message mutations (12.7s)
ok 4 apps\web\e2e\main-detail-projection.spec.ts:80:3 › main timeline and run detail projection › run detail opens from side panel with 7 tabs (3.3s)
4 passed (27.8s)
```

## Browser QA verdict
- Solo Room create → send → Mock reply/browser projection: PASS via actual UI mutation test plus timeline projection test.
- PendingTurn queue UI: PASS.
- Run Detail tabs: PASS.
- Browser session/CSRF behavior: PASS; `/auth/session` is proxied by `test-server.ts`, and the browser UI mutation test asserts CSRF headers on mutating requests.
- Blocking failures: none.
