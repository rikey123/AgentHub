# PF.5 — Terminal Artifact PTY Persistence

**VERDICT: NOT_PERSISTED (partial only)**

## What IS Stored

- Table: `artifacts`, column: `metadata` (JSON text)
- For `type="terminal"` artifacts, metadata contains:
  - `stdoutPreview` — first ~200 lines of stdout (truncated)
  - `stderrPreview` — first ~200 lines of stderr (truncated)
- `exit_code` is NOT stored in any normalized field
- Full stdout/stderr beyond the preview are NOT persisted

## What is NOT Stored

- Full PTY stdout (only preview)
- Full PTY stderr (only preview)
- Exit code
- No dedicated columns in `artifacts` or `artifact_files` for terminal output

## Storage Path

```
adapter tool call (Bash/terminal)
  → CreateArtifact command
  → ArtifactService.create(...)
  → metadataFor(type="terminal", ...)
  → insertArtifact(...)
  → artifacts.metadata JSON { stdoutPreview, stderrPreview }
```

Source: `packages/artifacts/src/index.ts`

## Impact on §7.7

§7.7 (TerminalCard PTY renderer) requires full stdout/stderr to:
- Show first 10 lines collapsed
- Expand to full virtualized log viewer
- Support search/copy

**Backend work required BEFORE §7.7 can proceed:**

1. Add canonical terminal output fields to `artifacts.metadata` schema:
   - `stdout: string` (full output)
   - `stderr: string`
   - `exitCode: number`
2. Update adapter/tool execution to write these fields when terminal runs complete
3. Update TerminalCard to read from canonical fields, not just previews

## Recommendation

Add a sub-task to §7.7 or create a backend task in W2 to persist full terminal output. This is within spec scope (spec says "MVP §11.6 已存数据" but the data is only partial). The fix is small — extend the metadata shape and ensure the adapter writes it.

**Do NOT start §7.7 UI work until full terminal output is confirmed persisted.**
