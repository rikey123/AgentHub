import { lineNumberFor, loadEventRegistry, readText, runCheck, walkFiles } from "./lib.mjs";

await runCheck("subscriptions:check", async function checkSubscriptions() {
  const errors = [];
  const registry = await loadEventRegistry();
  const registryTypes = new Set(registry.map((entry) => entry.type));
  const durableTypes = new Set(registry.filter((entry) => entry.durability === "durable").map((entry) => entry.type));
  const files = (await walkFiles("packages", { extensions: [".ts"] })).filter((file) => file.endsWith("subscribes.ts"));

  for (const file of files) {
    const source = await readText(file);
    for (const match of source.matchAll(/["`]([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)["`]/g)) {
      const eventType = match[1];
      if (!registryTypes.has(eventType)) {
        errors.push(`subscription '${eventType}' in ${file}:${lineNumberFor(source, match.index)} is not in the canonical event registry`);
      } else if (!durableTypes.has(eventType)) {
        errors.push(`subscription '${eventType}' in ${file}:${lineNumberFor(source, match.index)} is ephemeral; durable handlers may only subscribe to durable events`);
      }
    }
  }

  const busSpec = await readText("openspec/specs/bus-runtime/spec.md");
  for (const required of ["subscribes.ts", "DurableHandler", "handler_cursors", "last_seq", "agent.run.queued"]) {
    if (!busSpec.includes(required)) errors.push(`bus-runtime spec no longer exposes expected subscription contract marker '${required}'`);
  }

  checkSubscriptions.detail = files.length === 0 ? "0 subscribes.ts files yet; skeleton-friendly validation active" : `${files.length} subscribes.ts files`;
  return errors;
});
