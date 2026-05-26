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
        setRetryNote("Retry queued");
      } else if (res.status === 404) {
        setRetryStatus("missing");
        setRetryNote("Retry not implemented yet");
      } else {
        setRetryStatus("error");
        setRetryNote(`Retry failed (${res.status})`);
      }
    } catch (err) {
      setRetryStatus("error");
      setRetryNote(err instanceof Error ? err.message : "Retry failed");
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
          <Alert.Title>Mailbox delivery failed</Alert.Title>
          <Chip size="sm" variant="soft" color="danger">{props.attemptCount} attempt{props.attemptCount === 1 ? "" : "s"}</Chip>
          {props.onDismiss ? (
            <button
              type="button"
              aria-label="Dismiss"
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
            target {target} · {formatRelativeTime(props.failedAt)}
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
            {retryStatus === "retrying" ? "Retrying…" : "Retry"}
          </Button>
          <Button size="sm" variant="ghost" onPress={handleDebug}>Open debug</Button>
        </div>
      </Alert.Content>
    </Alert>
  );
}
