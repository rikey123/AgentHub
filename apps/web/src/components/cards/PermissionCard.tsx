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
          <Card.Title>请求许可</Card.Title>
          <Chip size="sm" variant="soft" color={permissionStatusColor(String(card.status))}>{permissionStatusLabel(String(card.status))}</Chip>
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
            始终允许此项目
          </Checkbox>
        ) : null}
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      </Card.Content>
      {!resolved ? (
        <Card.Footer className="gap-2">
          <Button variant="primary" isPending={pending === "allow"} onPress={() => resolve("allow")}>
            允许
          </Button>
          <Button variant="danger" isPending={pending === "deny"} onPress={() => resolve("deny")}>
            拒绝
          </Button>
        </Card.Footer>
      ) : null}
    </Card>
  );
}

function ResourceLabel({ resource }: { resource: PermissionResource }) {
  if (!resource || typeof resource !== "object") return <span>未知资源</span>;
  switch (resource.type) {
    case "file":
      return <span><strong>{permissionOperationLabel(resource.operation)}</strong> 文件 {resource.path}</span>;
    case "shell":
      return <span>运行 shell：<code className="ah-mono">{resource.command}</code></span>;
    case "tool":
      return <span>工具：<code className="ah-mono">{resource.toolName}</code></span>;
    case "context":
      return <span><strong>{permissionOperationLabel(resource.operation)}</strong> 上下文</span>;
    case "agent":
      return <span><strong>{permissionOperationLabel(resource.operation)}</strong> agent {resource.targetAgentId}</span>;
    default:
      return <span>{(resource as { type?: string }).type ?? "unknown"}</span>;
  }
}

function permissionOperationLabel(operation: string): string {
  if (operation === "read") return "只读";
  if (operation === "write") return "写入";
  if (operation === "execute") return "执行";
  if (operation === "delete") return "删除";
  return operation;
}

function permissionStatusLabel(status: string): string {
  if (status === "pending") return "待处理";
  if (status === "allowed") return "已允许";
  if (status === "denied") return "已拒绝";
  if (status === "expired") return "已过期";
  return status;
}
