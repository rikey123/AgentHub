import { Schema } from "effect";

export const IdSchema = Schema.String;
export type Id = typeof IdSchema.Type;

export const EpochMillisSchema = Schema.Number;
export type EpochMillis = typeof EpochMillisSchema.Type;

export const JsonObjectSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });
export type JsonObject = typeof JsonObjectSchema.Type;

export const EventVisibilitySchema = Schema.Literal("main", "detail", "both");
export type EventVisibility = typeof EventVisibilitySchema.Type;

export const EventDurabilitySchema = Schema.Literal("durable", "ephemeral");
export type EventDurability = typeof EventDurabilitySchema.Type;

export const ContextScopeSchema = Schema.Literal("conversation", "task", "workspace", "user");
export type ContextScope = typeof ContextScopeSchema.Type;

export const InjectionModeSchema = Schema.Literal("immediate", "next_turn", "next_session");
export type InjectionMode = typeof InjectionModeSchema.Type;
