import { Alert, Button } from "@heroui/react";

interface ConnectionBannerProps {
  status: "connected" | "connecting" | "reconnecting" | "offline" | "disconnected";
  error?: string | undefined;
  onRetry?: () => void;
}

export function ConnectionBanner({ status, error, onRetry }: ConnectionBannerProps) {
  if (status === "connected") return null;
  const alertStatus =
    status === "offline" ? "danger" :
    status === "reconnecting" || status === "connecting" ? "warning" :
    "default";
  const title =
    status === "offline" ? "连接已断开" :
    status === "reconnecting" ? "正在重新连接..." :
    status === "connecting" ? "正在连接..." : "连接不可用";
  return (
    <Alert status={alertStatus as never} role={status === "offline" ? "alert" : "status"} aria-live={status === "offline" ? "assertive" : "polite"}>
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        {error ? <Alert.Description>{error}</Alert.Description> : null}
        {onRetry ? (
          <div className="mt-2">
            <Button size="sm" variant="ghost" onPress={onRetry}>重试</Button>
          </div>
        ) : null}
      </Alert.Content>
    </Alert>
  );
}
