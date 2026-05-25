# Issue: Terminal Artifact PTY Output Only Partially Persisted

## Problem

§7.7 TerminalCard requires full stdout/stderr/exit_code from terminal artifacts. PF.5 found that only truncated previews (`stdoutPreview`, `stderrPreview`) are stored in `artifacts.metadata`. Full output and exit code are not persisted.

## Context

- Task: §7.7 Implement TerminalCard PTY renderer
- Spec refs: `web-ui/终端 Artifact 渲染（PTY 输出）`
- Files involved: `packages/artifacts/src/index.ts`, `packages/db/src/schema.ts`

## What I Tried

Read `packages/artifacts/src/index.ts` and `packages/db/src/schema.ts` in full.

## Observed Behavior

`artifacts.metadata` for `type="terminal"` only contains `stdoutPreview` and `stderrPreview` (truncated to ~200 lines). No `stdout`, `stderr`, or `exitCode` fields.

## Expected Behavior

Full stdout/stderr/exitCode should be available for TerminalCard to render the complete log with virtualization, search, and copy.

## Options

1. **Extend metadata schema** in `packages/artifacts/src/index.ts` to include `stdout`, `stderr`, `exitCode` fields and update adapter to write them. Small change, stays within existing metadata JSON pattern.
2. **Add dedicated storage** (e.g., separate file on disk referenced by path in metadata). More complex, better for very large outputs.
3. **Accept limitation** — only render preview in TerminalCard, add "view full log" link to raw stream. Deviates from spec.

## Recommendation

Option 1: Extend metadata to include full `stdout`, `stderr`, `exitCode`. Add this as a backend sub-task to §7.7 or as a new task in W2 before §7.7 starts. The adapter already has the data at tool completion time — it just needs to be written.

## Needs Decision

- [x] Extend metadata schema (Option 1) — recommended, within spec scope
- [ ] Is this a scope expansion requiring Oracle approval?
- [ ] Should this be a new task or sub-task of §7.7?
