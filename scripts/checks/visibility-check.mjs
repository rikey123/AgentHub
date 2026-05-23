import { loadEventRegistry, readText, runCheck } from "./lib.mjs";

await runCheck("visibility:check", async function checkVisibility() {
  const errors = [];
  const registry = await loadEventRegistry();
  const valid = new Set(["main", "detail", "both"]);

  for (const entry of registry) {
    if (!valid.has(entry.visibility)) errors.push(`event '${entry.type}' has invalid visibility '${entry.visibility}'`);
    if (entry.durability === "durable" && !entry.visibility) errors.push(`durable event '${entry.type}' lacks registered visibility`);
  }

  const migration = await readText("packages/db/migrations/0003_events.sql");
  if (!/visibility\s+TEXT\s+NOT\s+NULL/i.test(migration)) errors.push("0003_events.sql must define events.visibility as NOT NULL");
  if (!/idx_events_room_visibility/i.test(migration)) errors.push("0003_events.sql must create idx_events_room_visibility");

  const schema = await readText("packages/db/src/schema.ts");
  if (!/visibility:\s*text\("visibility"\)\.notNull\(\)/.test(schema)) errors.push("Drizzle events table must expose visibility as a not-null column");

  const envelope = await readText("packages/protocol/src/events/envelope.ts");
  if (!envelope.includes("visibility: EventVisibilitySchema")) errors.push("EventEnvelopeSchema must include visibility");
  if (!envelope.includes("envelope.visibility !== registryEntry.visibility")) errors.push("Envelope registry assertion must reject visibility mismatches");

  checkVisibility.detail = `${registry.filter((entry) => entry.durability === "durable").length} durable events with registered visibility`;
  return errors;
});
