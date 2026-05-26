import type { RoomViewModel } from "../../../types.ts";
import { Card, Chip } from "@heroui/react";
import { permissionStatusColor } from "../../../lib/status.ts";

export function PermissionsTab({ room, runId }: { room: RoomViewModel; runId: string }) {
  const perms = room.pendingPermissions.filter((p) => !p.runId || p.runId === runId);
  if (perms.length === 0) {
    return <div className="p-6 text-center text-sm text-muted">No permissions for this run.</div>;
  }
  return (
    <ul className="flex flex-col gap-2 p-3">
      {perms.map((p) => (
        <li key={p.id}>
          <Card variant="transparent" className="border border-border">
            <Card.Header>
              <div className="flex items-center gap-2">
                <Card.Title className="flex-1 text-sm">{p.resource.type}</Card.Title>
                <Chip size="sm" variant="soft" color={permissionStatusColor(p.status)}>{p.status}</Chip>
              </div>
              {p.reason ? <Card.Description className="text-xs">{p.reason}</Card.Description> : null}
              <span className="text-xs text-muted">{p.agentName}</span>
            </Card.Header>
          </Card>
        </li>
      ))}
    </ul>
  );
}
