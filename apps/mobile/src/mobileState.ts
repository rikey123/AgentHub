import type { EventEnvelope } from "@agenthub/protocol/events";
import type { AgentHubJsonObject, MobileSnapshotResponse } from "@agenthub/sdk";

export type MobileStatus = "idle" | "loading" | "connected" | "offline" | "error";

export type MobileState = {
  readonly status: MobileStatus;
  readonly cursor: number;
  readonly lastSyncedAt: number | null;
  readonly selectedRoomId: string | null;
  readonly rooms: readonly AgentHubJsonObject[];
  readonly messages: readonly AgentHubJsonObject[];
  readonly tasks: readonly AgentHubJsonObject[];
  readonly runs: readonly AgentHubJsonObject[];
  readonly permissions: readonly AgentHubJsonObject[];
  readonly artifacts: readonly AgentHubJsonObject[];
  readonly error?: string | undefined;
};

export const emptyMobileState: MobileState = {
  status: "idle",
  cursor: 0,
  lastSyncedAt: null,
  selectedRoomId: null,
  rooms: [],
  messages: [],
  tasks: [],
  runs: [],
  permissions: [],
  artifacts: []
};

export function applySnapshot(state: MobileState, snapshot: MobileSnapshotResponse): MobileState {
  const selectedRoomId = state.selectedRoomId ?? stringField(snapshot.rooms[0], "id") ?? null;
  return {
    ...state,
    status: "connected",
    cursor: snapshot.cursor,
    lastSyncedAt: Date.now(),
    selectedRoomId,
    rooms: snapshot.rooms,
    tasks: snapshot.tasks,
    runs: snapshot.runs,
    permissions: snapshot.permissions,
    artifacts: snapshot.artifacts,
    error: undefined
  };
}

export function markOffline(state: MobileState, error: string): MobileState {
  return { ...state, status: state.rooms.length > 0 ? "offline" : "error", error };
}

export function shouldRefreshSnapshot(event: EventEnvelope): boolean {
  return event.type.startsWith("room.")
    || event.type.startsWith("task.")
    || event.type.startsWith("run.")
    || event.type.startsWith("permission.")
    || event.type.startsWith("artifact.")
    || event.type.startsWith("message.");
}

export function mergeMessages(messages: readonly AgentHubJsonObject[], next: readonly AgentHubJsonObject[]): readonly AgentHubJsonObject[] {
  const seen = new Set<string>();
  const merged: AgentHubJsonObject[] = [];
  for (const message of [...messages, ...next]) {
    const id = stringField(message, "id");
    if (id !== undefined) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    merged.push(message);
  }
  return merged.sort((left, right) => numberField(left, "created_at", "createdAt") - numberField(right, "created_at", "createdAt"));
}

export function visibleForRoom(items: readonly AgentHubJsonObject[], roomId: string | null): readonly AgentHubJsonObject[] {
  if (roomId === null) return items;
  return items.filter((item) => stringField(item, "room_id", "roomId") === roomId);
}

export function stringField(record: AgentHubJsonObject | undefined, ...keys: readonly string[]): string | undefined {
  if (record === undefined) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function numberField(record: AgentHubJsonObject | undefined, ...keys: readonly string[]): number {
  if (record === undefined) return 0;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}
