import type { EventBus } from "@agenthub/bus";
import type { AgentHubDatabase } from "@agenthub/db";

export type WakeOutboxDispatchItem = {
  readonly id: string;
  readonly roomId: string;
  readonly agentId: string;
  readonly reason: string;
  readonly payload?: string | undefined;
};

export type WakeOutboxDispatcher = {
  readonly start: () => void;
  readonly stop: () => void;
  readonly dispatchPending: () => Promise<readonly WakeOutboxDispatchItem[]>;
};

export type WakeOutboxDispatcherOptions = {
  readonly database: AgentHubDatabase;
  readonly eventBus: EventBus;
  readonly now?: () => number;
};

function notImplemented(method: string): never {
  throw new Error(`WakeOutboxDispatcher.${method} is not implemented in the V1.2 contract foundation`);
}

export function createWakeOutboxDispatcher(_options: WakeOutboxDispatcherOptions): WakeOutboxDispatcher {
  return {
    start: () => notImplemented("start"),
    stop: () => notImplemented("stop"),
    dispatchPending: async () => notImplemented("dispatchPending")
  };
}
