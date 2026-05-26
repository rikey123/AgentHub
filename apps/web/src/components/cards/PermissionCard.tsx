import { Button, Card, Checkbox, Chip } from "@heroui/react";
import { useState } from "react";
import type { Card as ProtocolCard, PermissionResource } from "@agenthub/protocol/domains";
import { permissionStatusColor } from "../../lib/status.ts";

type PermissionCardData = Extract<ProtocolCard, { type: "permission" }>;

interface PermissionCardProps {
  card: PermissionCardData;
  csrfFetch: typeof fetch;
}

export function PermissionCard({ card, csrfFetch }: PermissionCardProps) {
  const [remember, setRemember] = useState(false);
  const [pending, setPending] = useState<"allow" | "deny" | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const resolved = card.status === "allowed" || card.status === "denied" || card.status === "expired";

  const resolve = async (decision: "allow" | "deny") => {
    setPending(decision);
    setError(undefined);
    try {
      const res = await csrfFetch(`/permissions/${encodeURIComponent(card.permissionId)}/resolve`, {
        method: "POST",
        body: JSON.stringify({ decision, remember, scope: remember ? "this_workspace" : "once" })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(undefined);
    }
  };

  return (
    <Card variant="default" className="border border-warning/40">
      <Card.Header>
        <div className="flex items-center gap-2">
          <Card.Title>Permission requested</Card.Title>
          <Chip size="sm" variant="soft" color={permissionStatusColor(String(card.status))}>{String(card.status)}</Chip>
        </div>
        <Card.Description>
          <ResourceLabel resource={card.resource as PermissionResource} />
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <div className="text-sm text-muted">
          <span>Agent <span className="font-medium text-foreground">{card.agentId}</span></span>
          {card.reason ? <p className="mt-1">{card.reason}</p> : null}
        </div>
        {!resolved ? (
          <Checkbox className="mt-3" isSelected={remember} onChange={setRemember}>
            Always allow for this project
          </Checkbox>
        ) : null}
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      </Card.Content>
      {!resolved ? (
        <Card.Footer className="gap-2">
          <Button variant="primary" isPending={pending === "allow"} onPress={() => resolve("allow")}>
            Allow
          </Button>
          <Button variant="danger" isPending={pending === "deny"} onPress={() => resolve("deny")}>
            Deny
          </Button>
        </Card.Footer>
      ) : null}
    </Card>
  );
}

function ResourceLabel({ resource }: { resource: PermissionResource }) {
  if (!resource || typeof resource !== "object") return <span>Unknown resource</span>;
  switch (resource.type) {
    case "file":
      return <span><strong>{resource.operation}</strong> file {resource.path}</span>;
    case "shell":
      return <span>Run shell: <code className="ah-mono">{resource.command}</code></span>;
    case "tool":
      return <span>Tool: <code className="ah-mono">{resource.toolName}</code></span>;
    case "context":
      return <span><strong>{resource.operation}</strong> context</span>;
    case "agent":
      return <span><strong>{resource.operation}</strong> agent {resource.targetAgentId}</span>;
    default:
      return <span>{(resource as { type?: string }).type ?? "unknown"}</span>;
  }
}
