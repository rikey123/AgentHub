import { useRawStream } from "../../../hooks/useRawStream.ts";
import { Chip, ScrollShadow } from "@heroui/react";

export function RawStreamTab({ roomId, runId }: { roomId: string; runId: string }) {
  const state = useRawStream(roomId, runId);

  if (state.status === "forbidden") {
    return (
      <div className="p-6 text-center text-sm text-muted" data-testid="raw-stream-content">
        查看原始流需要 admin scope 或 Debug 模式。
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="p-6 text-center text-sm text-danger" data-testid="raw-stream-content">
        无法连接到原始流。
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Chip size="sm" variant="soft" color={state.status === "connected" ? "success" : "warning"}>{rawStreamStatusLabel(state.status)}</Chip>
        <span className="text-xs text-muted">{state.lines.length} 行</span>
      </div>
      <ScrollShadow className="flex-1 overflow-auto" orientation="vertical">
        <pre className="ah-mono p-3 text-xs" data-testid="raw-stream-content">
          {state.lines.map((line, i) => (
            <div key={i} className={line.stream === "stderr" ? "text-danger" : ""}>{line.text}</div>
          ))}
        </pre>
      </ScrollShadow>
    </div>
  );
}

function rawStreamStatusLabel(status: string): string {
  switch (status) {
    case "connected":
      return "已连接";
    case "connecting":
      return "连接中";
    case "forbidden":
      return "无权限";
    case "error":
      return "连接失败";
    default:
      return status;
  }
}
