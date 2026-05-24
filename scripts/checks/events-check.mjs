import { lineNumberFor, loadEventRegistry, readText, runCheck, unique, walkFiles } from "./lib.mjs";

const eventLiteralPattern = /["`]([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)["`]/g;
const ignoredNonEventLiterals = new Set([
  "agent.run.aborted",
  "agent.knock",
  "artifact.publish",
  "auth.token",
  "auth.ts",
  "context.read",
  "context.write",
  "file.changed",
  "intervention.knock",
  "mailbox.id",
  "message.delta",
  "raw.stderr",
  "raw.stdout",
  "room.participants",
  "run.completed",
  "session.crashed",
  "session.ended",
  "session.opened",
  "task.delegate",
  "terminal.run",
  "tool.update",
  "tool.update.stdout",
  "web.fetch",
  "web.search"
]);

function expandSpecEventCell(cell) {
  const values = [];
  const normalized = cell.replaceAll("`", "").trim();
  if (!normalized || !normalized.includes(".")) return values;

  const parts = normalized.split("/").map((part) => part.trim()).filter(Boolean);
  let prefix = "";
  for (const part of parts) {
    if (part.startsWith(".")) {
      const suffix = part.slice(1);
      const firstSuffixSegment = suffix.split(".")[0];
      const base = suffix.includes(".")
        ? prefix.endsWith(`.${firstSuffixSegment}`)
          ? prefix.slice(0, -(firstSuffixSegment.length + 1))
          : prefix
        : prefix === "adapter.session" && suffix === "crashed"
          ? "adapter"
          : prefix;
      values.push(`${base}.${suffix}`);
      continue;
    }
    values.push(part);
    const lastDot = part.lastIndexOf(".");
    prefix = lastDot === -1 ? "" : part.slice(0, lastDot);
  }
  return values;
}

await runCheck("events:check", async function checkEvents() {
  const errors = [];
  const registry = await loadEventRegistry();
  const registryTypes = new Set(registry.map((entry) => entry.type));
  const seen = new Set();

  for (const entry of registry) {
    if (seen.has(entry.type)) errors.push(`duplicate event type '${entry.type}' in protocol registry`);
    seen.add(entry.type);
    if (entry.schemaVersion !== 1) errors.push(`event '${entry.type}' must stay on schemaVersion 1 until a v2 type is introduced`);
  }

  const eventSystemSpec = await readText("openspec/specs/event-system/spec.md");
  const adapterFrameworkSpec = await readText("openspec/specs/adapter-framework/spec.md");
  const specRows = [...eventSystemSpec.matchAll(/^\|\s*([^|`]*(?:`[^`]+`[^|`]*)+)\|\s*[^|]+\|\s*(durable|ephemeral)\s*\|\s*(main|detail|both)\s*\|/gm)];
  const specTypes = unique([
    ...specRows.flatMap((match) => expandSpecEventCell(match[1])),
    ...(adapterFrameworkSpec.includes("`file.changed`") ? ["file.changed"] : [])
  ]);
  for (const type of specTypes) {
    if (!registryTypes.has(type)) errors.push(`event-system canonical table includes '${type}' but protocol registry is missing it`);
  }
  for (const type of registryTypes) {
    if (!specTypes.includes(type)) errors.push(`protocol registry includes '${type}' but event-system canonical table is missing it`);
  }

  const sourceFiles = [
    ...(await walkFiles("packages", { extensions: [".ts"] })),
    ...(await walkFiles("apps", { extensions: [".ts", ".tsx"] }))
  ];
  const referenced = [];
  for (const file of sourceFiles) {
    const source = await readText(file);
    for (const match of source.matchAll(eventLiteralPattern)) {
      const literal = match[1];
      if (ignoredNonEventLiterals.has(literal)) continue;
      if (!literal.includes(".")) continue;
      if (registryTypes.has(literal)) {
        referenced.push(literal);
      } else if (/^(message|pending_turn|room|agent|run|tool|subagent|task|context|permission|intervention|artifact|adapter|mailbox|worktree|auth|handler|server|ui|stream)\./.test(literal)) {
        errors.push(`event '${literal}' referenced from ${file}:${lineNumberFor(source, match.index)} but missing in event-system canonical registry`);
      }
    }
  }

  const migrator = await readText("packages/protocol/src/events/migrator.ts");
  if (!migrator.includes("currentSchemaVersion = 1")) errors.push("EventMigrator must expose currentSchemaVersion = 1 in the M0 skeleton");
  if (!migrator.includes("assertEnvelopeMatchesRegistry")) errors.push("EventMigrator must validate migrated envelopes against the canonical registry");

  checkEvents.detail = `${registry.length} registered event types, ${unique(referenced).length} referenced in source`;
  return errors;
});
