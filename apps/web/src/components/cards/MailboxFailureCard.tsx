import { useState } from "react";
import { Alert, Button, Chip } from "@heroui/react";
import { formatRelativeTime } from "../../lib/format.ts";

export interface MailboxFailureCardProps {
  id: string;
  mailboxMessageId: string;
  targetAgentId: string;
  targetAgentName?: string | undefined;
  reason: string;
  attemptCount: number;
  failedAt: number;
  csrfFetch: typeof fetch;
  onDismiss?: (id: string) => void;
}

export function MailboxFailureCard(props: MailboxFailureCardProps) {
  const [retryStatus, setRetryStatus] = useState<"idle" | "retrying" | "ok" | "missing" | "error">("idle");
  const [retryNote, setRetryNote] = useState<string | null>(null);

  const handleRetry = async () => {
    setRetryStatus("retrying");
    setRetryNote(null);
    try {
      const res = await props.csrfFetch(`/mailbox/retry/${encodeURIComponent(props.mailboxMessageId)}`, { method: "POST" });
      if (res.ok) {
        setRetryStatus("ok");
        setRetryNote("已加入重试队列");
      } else if (res.status === 404) {
        setRetryStatus("missing");
        setRetryNote("当前版本暂不支持自动重试");
      } else {
        setRetryStatus("error");
        setRetryNote(`重试失败（${res.status}）`);
      }
    } catch (err) {
      setRetryStatus("error");
      setRetryNote(err instanceof Error ? err.message : "重试失败");
    }
  };

  const handleDebug = () => {
    const params = new URLSearchParams({ type: "mailbox_failure" });
    window.open(`/debug/events?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  const target = props.targetAgentName ?? props.targetAgentId;

  return (
    <Alert color="danger">
      <Alert.Content>
        <div className="flex items-start gap-2">
          <Alert.Title>消息投递失败</Alert.Title>
          <Chip size="sm" variant="soft" color="danger">已尝试 {props.attemptCount} 次</Chip>
          {props.onDismiss ? (
            <button
              type="button"
              aria-label="忽略这条失败提示"
              className="ml-auto text-muted hover:text-foreground"
              onClick={() => props.onDismiss?.(props.id)}
            >
              ×
            </button>
          ) : null}
        </div>
        <Alert.Description>
          <span className="block">{props.reason}</span>
          <span className="block text-xs text-muted">
            目标 {target} · {formatRelativeTime(props.failedAt)}
          </span>
          {retryNote ? <span className="block text-xs">{retryNote}</span> : null}
        </Alert.Description>
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onPress={handleRetry}
            isDisabled={retryStatus === "retrying"}
          >
            {retryStatus === "retrying" ? "正在重试..." : "重试"}
          </Button>
          <Button size="sm" variant="ghost" onPress={handleDebug}>查看调试信息</Button>
        </div>
      </Alert.Content>
    </Alert>
  );
}
