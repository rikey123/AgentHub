import { useEffect, useState } from "react";
import { isInternalRuntimeKind } from "../lib/runtimeDisplay.ts";
import { ensureAuthSession } from "./useSdk.ts";

export type AgentSummary = {
  id: string;
  name: string;
  description?: string | undefined;
  avatar?: string | undefined;
  provider: string;
  adapterId: string;
  defaultPresence: string;
  capabilities: string[];
  hidden: boolean;
};

type RawAgent = {
  id: string;
  name: string;
  description?: string | null;
  avatar?: string | null;
  provider?: string | null;
  adapter_id?: string | null;
  adapterId?: string | null;
  default_presence?: string | null;
  defaultPresence?: string | null;
  capabilities?: string | string[] | null;
  hidden?: number | boolean | null;
};

function normalize(raw: RawAgent): AgentSummary {
  let caps: string[] = [];
  if (Array.isArray(raw.capabilities)) {
    caps = raw.capabilities.filter((c): c is string => typeof c === "string");
  } else if (typeof raw.capabilities === "string") {
    try {
      const parsed = JSON.parse(raw.capabilities);
      if (Array.isArray(parsed)) caps = parsed.filter((c): c is string => typeof c === "string");
    } catch {
      // ignore
    }
  }
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? undefined,
    avatar: raw.avatar ?? undefined,
    provider: raw.provider ?? "native",
    adapterId: raw.adapter_id ?? raw.adapterId ?? "native",
    defaultPresence: raw.default_presence ?? raw.defaultPresence ?? "observing",
    capabilities: caps,
    hidden: raw.hidden === true || raw.hidden === 1
  };
}

function isInternalAgent(agent: AgentSummary): boolean {
  return isInternalRuntimeKind(agent.adapterId) || isInternalRuntimeKind(agent.id) || isInternalRuntimeKind(agent.name);
}

export function useAgents(): { agents: AgentSummary[]; loading: boolean; error: string | undefined; refresh: () => void } {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    ensureAuthSession()
      .then(() => fetch("/agents", { credentials: "same-origin" }))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ agents?: RawAgent[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        const list = (data.agents ?? []).map(normalize).filter((a) => !a.hidden && !isInternalAgent(a));
        setAgents(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tick]);

  return { agents, loading, error, refresh: () => setTick((t) => t + 1) };
}
