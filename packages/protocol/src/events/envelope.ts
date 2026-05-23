import { Schema } from "effect";
import { EpochMillisSchema, EventDurabilitySchema, EventVisibilitySchema, IdSchema } from "../primitives.ts";
import { EVENT_REGISTRY, type EventType } from "./registry.ts";

const eventTypeLiterals = EVENT_REGISTRY.map((entry) => entry.type) as [EventType, EventType, ...EventType[]];

export const EventTypeSchema = Schema.Literal(...eventTypeLiterals);
export type RegisteredEventType = typeof EventTypeSchema.Type;

export const EventEnvelopeSchema = Schema.Struct({
  id: IdSchema,
  type: EventTypeSchema,
  schemaVersion: Schema.Number,
  durability: EventDurabilitySchema,
  visibility: EventVisibilitySchema,
  seq: Schema.optional(Schema.Number),
  workspaceId: IdSchema,
  roomId: Schema.optional(IdSchema),
  taskId: Schema.optional(IdSchema),
  runId: Schema.optional(IdSchema),
  agentId: Schema.optional(IdSchema),
  traceId: Schema.optional(IdSchema),
  causationId: Schema.optional(IdSchema),
  correlationId: Schema.optional(IdSchema),
  payload: Schema.Unknown,
  createdAt: EpochMillisSchema
});
export type EventEnvelope = typeof EventEnvelopeSchema.Type;

export function assertEnvelopeMatchesRegistry(envelope: EventEnvelope): void {
  const registryEntry = EVENT_REGISTRY.find((entry) => entry.type === envelope.type);
  if (!registryEntry) {
    throw new Error(`event type '${envelope.type}' not found in canonical registry`);
  }

  if (envelope.schemaVersion !== registryEntry.schemaVersion) {
    throw new Error(`event '${envelope.type}' schemaVersion ${envelope.schemaVersion} does not match registry version ${registryEntry.schemaVersion}`);
  }

  if (envelope.durability !== registryEntry.durability) {
    throw new Error(`event '${envelope.type}' durability '${envelope.durability}' does not match registry '${registryEntry.durability}'`);
  }

  if (envelope.visibility !== registryEntry.visibility) {
    throw new Error(`event '${envelope.type}' visibility '${envelope.visibility}' does not match registry '${registryEntry.visibility}'`);
  }

  if (envelope.durability === "durable" && envelope.seq === undefined) {
    throw new Error(`durable event '${envelope.type}' requires seq after persistence`);
  }

  if (envelope.durability === "ephemeral" && envelope.seq !== undefined) {
    throw new Error(`ephemeral event '${envelope.type}' must not carry seq`);
  }
}
