import type { RoomViewModel } from "../../types.ts";
import { Card } from "@heroui/react";

export function DebugPanel({ room }: { room: RoomViewModel }) {
  const rows: Array<[string, number | string]> = [
    ["Room ID", room.id],
    ["Messages", room.messages.length],
    ["Briefs", room.briefs.length],
    ["Runs", room.runs.length],
    ["Pending turns", room.pendingTurns.length],
    ["Permissions", room.pendingPermissions.length],
    ["Interventions", room.unresolvedInterventions.length],
    ["Context items", room.contextItems.length],
    ["Tasks", room.tasks.length],
    ["Participants", room.participants.length]
  ];
  return (
    <div className="p-3">
      <Card variant="transparent" className="border border-border">
        <Card.Header>
          <Card.Title>Debug snapshot</Card.Title>
        </Card.Header>
        <Card.Content>
          <table className="w-full text-sm">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k} className="border-b border-border last:border-0">
                  <td className="py-1.5 pr-2 text-muted">{k}</td>
                  <td className="py-1.5 ah-mono break-all">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card.Content>
      </Card>
    </div>
  );
}
