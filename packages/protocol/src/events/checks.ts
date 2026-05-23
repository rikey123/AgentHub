import { Schema } from "effect";
import { EventEnvelopeSchema } from "./envelope.ts";
import { EVENT_REGISTRY } from "./registry.ts";

export type SchemaCheckResult = {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly checkedEventTypes: number;
};

export function checkProtocolSchemas(): SchemaCheckResult {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const entry of EVENT_REGISTRY) {
    if (seen.has(entry.type)) {
      errors.push(`duplicate event type '${entry.type}'`);
    }
    seen.add(entry.type);

    if (entry.schemaVersion !== 1) {
      errors.push(`event '${entry.type}' must remain v1 in the M0.3 skeleton`);
    }

  }

  const durableEntry = EVENT_REGISTRY.find((entry) => entry.durability === "durable");
  const ephemeralEntry = EVENT_REGISTRY.find((entry) => entry.durability === "ephemeral");

  if (!durableEntry || !ephemeralEntry) {
    errors.push("event registry must include durable and ephemeral classifications");
  }

  if (durableEntry) {
    Schema.decodeUnknownSync(EventEnvelopeSchema)({
      id: "evt_schema_check_durable",
      type: durableEntry.type,
      schemaVersion: 1,
      durability: durableEntry.durability,
      visibility: durableEntry.visibility,
      seq: 1,
      workspaceId: "workspace_schema_check",
      payload: {},
      createdAt: 0
    });
  }

  if (ephemeralEntry) {
    Schema.decodeUnknownSync(EventEnvelopeSchema)({
      id: "evt_schema_check_ephemeral",
      type: ephemeralEntry.type,
      schemaVersion: 1,
      durability: ephemeralEntry.durability,
      visibility: ephemeralEntry.visibility,
      workspaceId: "workspace_schema_check",
      payload: {},
      createdAt: 0
    });
  }

  return { ok: errors.length === 0, errors, checkedEventTypes: EVENT_REGISTRY.length };
}
