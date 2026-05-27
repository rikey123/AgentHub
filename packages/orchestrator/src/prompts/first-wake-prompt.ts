import type { AgentHubDatabase } from "@agenthub/db";
import { nameToSlug } from "../mention-parser.ts";
import { buildLeaderPrompt } from "./lead-prompt.ts";
import { buildTeammatePrompt } from "./teammate-prompt.ts";

type DbLike = AgentHubDatabase;

/**
 * Build the role prompt for the first wake of a run.
 *
 * - In team/squad rooms: leader gets buildLeaderPrompt, teammates get buildTeammatePrompt.
 * - In assisted rooms: all agents get a lightweight teammates section appended to their role_prompt.
 * - Returns undefined if this is not the first wake (prior assistant message exists for this run).
 */
export function buildFirstWakePrompt(
  runId: string,
  agentId: string,
  roomId: string,
  db: DbLike
): string | undefined {
  // Only inject on first wake — check for any prior assistant message in this run.
  const priorAssistant = db.sqlite
    .prepare("SELECT id FROM messages WHERE run_id = ? AND role = 'assistant' LIMIT 1")
    .get(runId);
  if (priorAssistant !== undefined) return undefined;

  const profile = db.sqlite
    .prepare("SELECT role_prompt, name FROM agent_profiles WHERE id = ?")
    .get(agentId) as { role_prompt: string; name: string } | undefined;

  const room = db.sqlite
    .prepare("SELECT mode, primary_agent_id FROM rooms WHERE id = ?")
    .get(roomId) as { mode: string; primary_agent_id: string | null } | undefined;

  const agentName = profile?.name ?? agentId;
  const roomMode = room?.mode ?? "solo";

  // Fetch all participants with their profiles and presence.
  const participants = db.sqlite
    .prepare(
      `SELECT rp.participant_id AS agentId, rp.role, ap.name, ap.adapter_id AS adapterId,
              COALESCE(ap2.state, 'offline') AS presence
       FROM room_participants rp
       LEFT JOIN agent_profiles ap ON ap.id = rp.participant_id
       LEFT JOIN agent_presence ap2 ON ap2.room_id = rp.room_id AND ap2.agent_id = rp.participant_id
       WHERE rp.room_id = ? AND rp.participant_type = 'agent'
       ORDER BY rp.joined_at ASC`
    )
    .all(roomId) as { agentId: string; role: string; name: string | null; adapterId: string | null; presence: string }[];

  const others = participants.filter((p) => p.agentId !== agentId);
  const othersFormatted = others.map((p) => ({
    agentId: p.agentId,
    name: p.name ?? p.agentId,
    slug: nameToSlug(p.name ?? p.agentId),
    role: p.role,
    presence: p.presence,
  }));

  // In team/squad mode, use structured leader/teammate prompts.
  if (roomMode === "team" || roomMode === "squad") {
    const myParticipant = participants.find((p) => p.agentId === agentId);
    const isLeader = myParticipant?.role === "primary" || agentId === room?.primary_agent_id;

    if (isLeader) {
      return buildLeaderPrompt({
        agentName,
        teammates: othersFormatted,
      });
    }

    // Find the leader.
    const leaderParticipant = participants.find(
      (p) => p.role === "primary" || p.agentId === room?.primary_agent_id
    );
    const leaderName = leaderParticipant?.name ?? leaderParticipant?.agentId ?? "Leader";
    const leaderSlug = nameToSlug(leaderName);
    const nonLeaderOthers = othersFormatted.filter((p) => p.agentId !== leaderParticipant?.agentId);

    return buildTeammatePrompt({
      agentName,
      leaderName,
      leaderSlug,
      teammates: nonLeaderOthers,
    });
  }

  // In assisted mode (or solo with teammates): append teammates section to role_prompt.
  const basePrompt = profile?.role_prompt?.trim() ?? "";
  if (others.length === 0) return basePrompt.length > 0 ? basePrompt : undefined;

  const teammateLines = othersFormatted
    .map((t) => `- **${t.name}** (@${t.slug}) — role: ${t.role}, presence: ${t.presence}`)
    .join("\n");

  const firstTeammateSlug = othersFormatted[0]?.slug ?? "teammate";

  const teammatesSection = `## Your Teammates

You are in a multi-agent room. Use the \`room.send_message\` MCP tool with @mentions to contact teammates.

${teammateLines}

Example: \`room.send_message({ text: "@${firstTeammateSlug} please review this" })\`

Use \`room.list_members\` to see the current roster and presence status.

## Receiving Messages from Other Agents (CRITICAL)

When woken by a message from another agent, ask first: **does this message contain a concrete task for me?**

- If YES → do the work, report results.
- If NO (greeting, test, acknowledgement, "got it", etc.) → send ONE short reply at most, then **end your turn immediately**. Do NOT call \`room.send_message\` again unless you have actual results to report.

Every \`room.send_message\` wakes the recipient. Replying to non-task messages creates infinite loops.`;

  if (basePrompt.length === 0) return teammatesSection;
  return `${basePrompt}\n\n${teammatesSection}`;
}
