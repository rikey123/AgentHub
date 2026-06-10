import type { AgentHubDatabase } from "@agenthub/db";

export function resolveWakeOutboxAgentId(database: AgentHubDatabase, roomId: string, agentId: string): string | undefined {
  const directBinding = database.sqlite.prepare("SELECT id FROM agent_bindings WHERE id = ? LIMIT 1").get(agentId) as { readonly id: string } | undefined;
  if (directBinding !== undefined) return directBinding.id;

  const participant = database.sqlite
    .prepare(
      `SELECT agent_binding_id
       FROM room_participants
       WHERE room_id = ? AND participant_id = ? AND participant_type = 'agent' AND agent_binding_id IS NOT NULL
       LIMIT 1`
    )
    .get(roomId, agentId) as { readonly agent_binding_id: string | null } | undefined;
  return participant?.agent_binding_id ?? undefined;
}

export function resolveWakeCommandAgentId(database: AgentHubDatabase, roomId: string, wakeOutboxAgentId: string): string {
  const participant = database.sqlite
    .prepare(
      `SELECT participant_id
       FROM room_participants
       WHERE room_id = ? AND agent_binding_id = ? AND participant_type = 'agent'
       ORDER BY joined_at ASC
       LIMIT 1`
    )
    .get(roomId, wakeOutboxAgentId) as { readonly participant_id: string } | undefined;
  return participant?.participant_id ?? wakeOutboxAgentId;
}
