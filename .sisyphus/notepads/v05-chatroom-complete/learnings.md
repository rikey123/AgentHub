
## ¡ì0.3 BriefGenerator
- packages/context keeps exports in src/index.ts; HeuristicBriefGenerator.generate() returns Effect.succeed(...) and stays pure/synchronous for V0.5.
- The context package needed an explicit effect dependency once its public interface imported Effect; run tests through pnpm.cmd on Windows when pnpm.ps1 is blocked by execution policy.
- packages/protocol/src/domains.ts did not define RunFailureClass at this point, so ¡ì0.3 used a local compatible context union to stay within the package boundary.

