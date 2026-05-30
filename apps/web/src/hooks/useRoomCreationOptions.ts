import { useEffect, useState } from "react";
import { ensureAuthSession } from "./useSdk.ts";
import { normalizeModelConfigs, type ModelConfig } from "../components/settings/ModelsTab.tsx";
import { normalizeRoles, type RoleConfig } from "../components/settings/RolesTab.tsx";
import { normalizeRuntimeList, type RuntimeConfig } from "../components/settings/RuntimesTab.tsx";

export interface AgentBindingSummary {
  id: string;
  roleId: string;
  runtimeId: string;
  modelConfigId: string | null;
}

export interface RoomCreationOptions {
  roles: RoleConfig[];
  runtimes: RuntimeConfig[];
  modelConfigs: ModelConfig[];
  agentBindings: AgentBindingSummary[];
}

type RoomCreationOptionsState = RoomCreationOptions & {
  loading: boolean;
  error: string | undefined;
  refresh: () => void;
};

const emptyOptions = (): RoomCreationOptions => ({
  roles: [],
  runtimes: [],
  modelConfigs: [],
  agentBindings: []
});

export function useRoomCreationOptions(): RoomCreationOptionsState {
  const [options, setOptions] = useState<RoomCreationOptions>(() => emptyOptions());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);

    void ensureAuthSession()
      .then(() => fetchRoomCreationOptions(fetch, controller.signal))
      .then((next) => {
        if (!cancelled) setOptions(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [tick]);

  return {
    ...options,
    loading,
    error,
    refresh: () => setTick((current) => current + 1)
  };
}

export async function fetchRoomCreationOptions(fetchImpl: typeof fetch, signal: AbortSignal): Promise<RoomCreationOptions> {
  const [roles, runtimes, modelConfigs, agentBindings] = await Promise.all([
    fetchJson(fetchImpl, "/roles", signal),
    fetchJson(fetchImpl, "/runtimes", signal),
    fetchJson(fetchImpl, "/model-configs", signal),
    fetchJson(fetchImpl, "/agent-bindings", signal)
  ]);
  return {
    roles: normalizeRoles(roles),
    runtimes: normalizeRuntimeList(runtimes),
    modelConfigs: normalizeModelConfigs(modelConfigs),
    agentBindings: normalizeAgentBindings(agentBindings)
  };
}

function normalizeAgentBindings(payload: unknown): AgentBindingSummary[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { readonly agentBindings?: unknown }).agentBindings)
      ? (payload as { readonly agentBindings: unknown[] }).agentBindings
      : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const id = stringField(record.id);
    const roleId = stringField(record.roleId ?? record.role_id);
    const runtimeId = stringField(record.runtimeId ?? record.runtime_id);
    if (!id || !roleId || !runtimeId) return [];
    return [{
      id,
      roleId,
      runtimeId,
      modelConfigId: nullableString(record.modelConfigId ?? record.model_config_id)
    }];
  });
}

async function fetchJson(fetchImpl: typeof fetch, path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetchImpl(path, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal
  });
  if (!response.ok) throw new Error(`Room creation bootstrap ${path} failed: ${response.status}`);
  return response.json() as Promise<unknown>;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
