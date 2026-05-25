import { useEffect, useRef, useState } from "react";
import type { EventEnvelope } from "@agenthub/protocol/events";
import { ensureAuthSession } from "./useSdk.ts";

export type RawLine = {
  readonly text: string;
  readonly stream: "stdout" | "stderr";
  readonly seq: number | undefined;
};

export type RawStreamState = {
  readonly lines: readonly RawLine[];
  readonly status: "connecting" | "connected" | "error" | "forbidden";
};

function getRawToken(): string | undefined {
  if (typeof window !== "undefined") {
    const token = (window as unknown as Record<string, unknown>).__AGENTHUB_RAW_TOKEN__;
    if (typeof token === "string") return token;
  }
  return undefined;
}

function parseSseEvent(chunk: string): { event: string | undefined; data: string | undefined } | undefined {
  const lines = chunk.split("\n");
  let event: string | undefined;
  let data: string | undefined;
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data = line.slice(5).trim();
    }
  }
  if (event === undefined && data === undefined) return undefined;
  return { event, data };
}

export function useRawStream(roomId: string | undefined, runId: string | undefined): RawStreamState {
  const [state, setState] = useState<RawStreamState>({ lines: [], status: "connecting" });
  const linesRef = useRef<RawLine[]>([]);

  useEffect(() => {
    if (!roomId || !runId) {
      setState({ lines: [], status: "error" });
      return;
    }

    linesRef.current = [];
    setState({ lines: [], status: "connecting" });

    let cancelled = false;
    let abortController: AbortController | null = null;

    ensureAuthSession()
      .then(() => {
        if (cancelled) return;
        const params = new URLSearchParams();
        params.set("view", "raw");
        params.set("roomId", roomId);
        params.set("runId", runId);

        const url = `/event?${params.toString()}`;
        const token = getRawToken();
        const headers: Record<string, string> = { accept: "text/event-stream" };
        if (token) headers.authorization = `Bearer ${token}`;

        abortController = new AbortController();
        return fetch(url, { headers, signal: abortController.signal, credentials: "same-origin", mode: "cors" });
      })
      .then((response) => {
        if (!response) return;
        if (response.status === 403) {
          if (!cancelled) setState({ lines: [], status: "forbidden" });
          return;
        }
        if (!response.ok || !response.body) {
          if (!cancelled) setState({ lines: [], status: "error" });
          return;
        }
        if (!cancelled) setState({ lines: [], status: "connected" });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const processChunk = (): Promise<void> => {
          if (cancelled) return Promise.resolve();
          return reader.read().then(({ done, value }) => {
            if (done || cancelled) return;
            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split("\n\n");
            buffer = chunks.pop() ?? "";
            for (const chunk of chunks) {
              const parsed = parseSseEvent(chunk);
              if (!parsed || !parsed.data) continue;
              if (parsed.data.startsWith("heartbeat")) continue;
              try {
                const envelope = JSON.parse(parsed.data) as EventEnvelope;
                if (envelope.type === "adapter.raw.stdout" || envelope.type === "adapter.raw.stderr") {
                  const payload = envelope.payload as Record<string, unknown> | undefined;
                  const line = typeof payload?.line === "string" ? payload.line : "";
                  const stream = envelope.type === "adapter.raw.stdout" ? "stdout" : "stderr";
                  const newLine: RawLine = { text: line, stream, seq: envelope.seq };
                  linesRef.current = [...linesRef.current, newLine];
                  if (!cancelled) setState({ lines: linesRef.current, status: "connected" });
                }
              } catch {
                // ignore malformed events
              }
            }
            return processChunk();
          }).catch(() => {
            if (!cancelled) setState((prev) => ({ lines: prev.lines, status: prev.lines.length > 0 ? "error" : "forbidden" }));
          });
        };

        return processChunk();
      })
      .catch(() => {
        if (!cancelled) setState({ lines: [], status: "error" });
      });

    return () => {
      cancelled = true;
      if (abortController) abortController.abort();
    };
  }, [roomId, runId]);

  return state;
}
