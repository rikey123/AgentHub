import type { RoomViewModel } from "../../types.ts";
import { Card } from "@heroui/react";

export function DebugPanel({ room }: { room: RoomViewModel }) {
  const rows: Array<[string, number | string]> = [
    ["Room ID", room.id],
    ["消息", room.messages.length],
    ["简报", room.briefs.length],
    ["运行", room.runs.length],
    ["待处理轮次", room.pendingTurns.length],
    ["权限", room.pendingPermissions.length],
    ["干预", room.unresolvedInterventions.length],
    ["上下文条目", room.contextItems.length],
    ["任务", room.tasks.length],
    ["成员", room.participants.length]
  ];
  return (
    <div className="px-3 py-2">
      <Card variant="transparent" className="border border-border">
        <Card.Header className="pb-1">
          <Card.Title>Debug 快照</Card.Title>
        </Card.Header>
        <Card.Content className="pt-0">
          <table className="w-full text-sm">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k} className="border-b border-border last:border-0">
                  <td className="py-1 pr-2 text-muted">{k}</td>
                  <td className="py-1 ah-mono break-all">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card.Content>
      </Card>
    </div>
  );
}
