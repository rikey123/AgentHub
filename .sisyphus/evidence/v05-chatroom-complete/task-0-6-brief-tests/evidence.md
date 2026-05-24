## task-0-6-brief-tests

### Verified test cases in `packages/context/test/context.test.ts`
- first sentence truncation
- Chinese punctuation
- code block skip
- failure template
- cancel template
- parse failure fallback
- artifact suffix only when nonzero

### Verification
- Command: `pnpm --filter @agenthub/context test --run brief-generator`
- Result: passed (19 tests, 1 file)
