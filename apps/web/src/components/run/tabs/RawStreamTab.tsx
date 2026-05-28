import { useRawStream } from "../../../hooks/useRawStream.ts";
import { Chip, ScrollShadow } from "@heroui/react";

export function RawStreamTab({ roomId, runId }: { roomId: string; runId: string }) {
  const state = useRawStream(roomId, runId);

  if (state.status === "forbidden") {
    return (
      <div className="p-6 text-center text-sm text-muted" data-testid="raw-stream-content">
        Raw stream content requires admin scope or debug mode.
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="p-6 text-center text-sm text-danger" data-testid="raw-stream-content">
        Could not connect to raw stream.
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Chip size="sm" variant="soft" color={state.status === "connected" ? "success" : "warning"}>{state.status}</Chip>
        <span className="text-xs text-muted">{state.lines.length} lines</span>
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
