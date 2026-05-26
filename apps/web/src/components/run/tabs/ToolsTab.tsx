import type { RoomViewModel } from "../../../types.ts";
import { Card, Chip } from "@heroui/react";

export function ToolsTab({ room, runId }: { room: RoomViewModel; runId: string }) {
  const messages = room.messages.filter((m) => m.runId === runId);
  const calls = messages.flatMap((m) =>
    m.parts
      .map((p, idx) => ({ messageId: m.id, idx, part: p }))
      .filter(({ part }) => part.type === "tool_call" || part.type === "tool_result")
  );
  const subagents = room.runs.filter((r) => r.id !== runId);

  return (
    <div className="flex flex-col gap-3 p-3">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Tool calls</h3>
        {calls.length === 0 ? <p className="text-sm text-muted">No tool calls.</p> : (
          <ul className="flex flex-col gap-2">
            {calls.map(({ messageId, idx, part }) => (
              <li key={`${messageId}-${idx}`}>
                <Card variant="transparent" className="border border-border">
                  <Card.Header>
                    <div className="flex items-center gap-2">
                      <Card.Title className="text-sm">
                        {part.type === "tool_call" ? `Call · ${part.name}` : "Result"}
                      </Card.Title>
                      {part.type === "tool_result" ? (
                        <Chip size="sm" variant="soft" color={part.ok ? "success" : "danger"}>
                          {part.ok ? "ok" : "error"}
                        </Chip>
                      ) : null}
                    </div>
                  </Card.Header>
                  <Card.Content>
                    <pre className="ah-mono max-h-32 overflow-auto rounded bg-surface-secondary p-2 text-xs">
                      {JSON.stringify(part.type === "tool_call" ? part.input : part.type === "tool_result" ? part.output : null, null, 2)}
                    </pre>
                  </Card.Content>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
      {subagents.length > 0 ? (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Subagent runs</h3>
          <ul className="flex flex-col gap-2">
            {subagents.map((sub) => (
              <li key={sub.id}>
                <Card variant="transparent" className="border border-border">
                  <Card.Header>
                    <div className="flex items-center gap-2">
                      <Card.Title className="text-sm">{sub.agentName}</Card.Title>
                      <Chip size="sm" variant="soft" color="default">{sub.status}</Chip>
                    </div>
                    <Card.Description className="text-xs ah-mono">{sub.id}</Card.Description>
                  </Card.Header>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
