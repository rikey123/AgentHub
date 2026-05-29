import type { AgentHubDatabase } from "@agenthub/db";

export function resolveAgentProfileToBinding(database: AgentHubDatabase, agentProfileId: string): string | null {
  const row = database.sqlite.prepare("SELECT id FROM agent_bindings WHERE id = ?").get(agentProfileId) as { readonly id?: string } | undefined;
  return row?.id ?? null;
}

export function normalizeRoomCreateCompat(database: AgentHubDatabase, input: Record<string, unknown>):
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly status: 404; readonly error: "agent_profile_not_found" } {
  const agentProfileId = typeof input.agentProfileId === "string" ? input.agentProfileId : undefined;
  if (agentProfileId === undefined) return { ok: true, body: input };

  const agentBindingId = resolveAgentProfileToBinding(database, agentProfileId);
  if (agentBindingId === null) return { ok: false, status: 404, error: "agent_profile_not_found" };

  return { ok: true, body: { ...input, agentProfileId, agentBindingId, primaryAgentId: agentBindingId } };
}
