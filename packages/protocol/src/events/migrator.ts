import { Schema } from "effect";
import { EventEnvelopeSchema, assertEnvelopeMatchesRegistry, type EventEnvelope } from "./envelope.ts";

export class UnsupportedEventSchemaVersionError extends Error {
  constructor(readonly schemaVersion: number) {
    super(`unsupported event schemaVersion ${schemaVersion}`);
    this.name = "UnsupportedEventSchemaVersionError";
  }
}

export class EventMigrator {
  static readonly currentSchemaVersion = 1;

  migrate(input: unknown): EventEnvelope {
    const envelope = Schema.decodeUnknownSync(EventEnvelopeSchema)(input);

    if (envelope.schemaVersion === EventMigrator.currentSchemaVersion) {
      assertEnvelopeMatchesRegistry(envelope);
      return envelope;
    }

    throw new UnsupportedEventSchemaVersionError(envelope.schemaVersion);
  }
}

export const eventMigrator = new EventMigrator();
