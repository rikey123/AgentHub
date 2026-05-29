import type { RoomViewModel } from "../../../types.ts";
import { Card, Chip } from "@heroui/react";
import { permissionStatusColor } from "../../../lib/status.ts";

export function PermissionsTab({ room, runId, permissionSummary }: { room: RoomViewModel; runId: string; permissionSummary?: RoomViewModel["runs"][number]["permissionSummary"] }) {
  const run = room.runs.find((r) => r.id === runId);
  const perms = room.pendingPermissions.filter((p) => !p.runId || p.runId === runId);
  const summary = permissionSummary ?? run?.permissionSummary ?? [];
  if (perms.length === 0) {
    return summary.length === 0 ? <div className="p-6 text-center text-sm text-muted">No permissions for this run.</div> : (
      <div className="flex flex-col gap-3 p-3">
        {summary.map((item, index) => (
          <Card key={`${item.modelConfigId}-${index}`} variant="transparent" className="border border-border">
            <Card.Header>
              <div className="flex items-center gap-2">
                <Card.Title className="flex-1 text-sm">{item.resource.type}</Card.Title>
                <Chip size="sm" variant="soft" color={item.decision === "allowed" ? "success" : item.decision === "denied" ? "danger" : "warning"}>{item.decision}</Chip>
              </div>
              <Card.Description className="text-xs">model: {item.modelConfigId}</Card.Description>
            </Card.Header>
          </Card>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 p-3">
      {summary.length > 0 ? (
        summary.map((item, index) => (
          <Card key={`${item.modelConfigId}-${index}`} variant="transparent" className="border border-border">
            <Card.Header>
              <div className="flex items-center gap-2">
                <Card.Title className="flex-1 text-sm">{item.resource.type}</Card.Title>
                <Chip size="sm" variant="soft" color={item.decision === "allowed" ? "success" : item.decision === "denied" ? "danger" : "warning"}>{item.decision}</Chip>
              </div>
              <Card.Description className="text-xs">model: {item.modelConfigId}</Card.Description>
            </Card.Header>
          </Card>
        ))
      ) : null}
      <ul className="flex flex-col gap-2">
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
    </div>
  );
}
