import { useEffect, useState } from "react";
import { Card, Chip, Spinner } from "@heroui/react";
import { CardRenderer } from "../../cards/CardRenderer.tsx";
import { TerminalCard } from "../../cards/TerminalCard.tsx";
import type { RoomViewModel } from "../../../types.ts";

interface ArtifactsTabProps {
  room: RoomViewModel;
  runId: string;
  csrfFetch: typeof fetch;
}

type ArtifactSummary = {
  id: string;
  type: string;
  title: string;
  status: string;
  metadata?: Record<string, unknown> | undefined;
};

type TerminalLine = { stream: "stdout" | "stderr"; text: string };

type TerminalState = {
  lines: TerminalLine[];
  exitCode: number | null;
};

function metadataTerminalState(meta: Record<string, unknown> | undefined): TerminalState {
  const lines: TerminalLine[] = [];
  const stdout = meta?.stdout;
  const stderr = meta?.stderr;
  if (typeof stdout === "string") {
    lines.push(...stdout.split(/\r?\n/).filter((line) => line.length > 0).map((line) => ({ stream: "stdout" as const, text: line })));
  }
  if (typeof stderr === "string") {
    lines.push(...stderr.split(/\r?\n/).filter((line) => line.length > 0).map((line) => ({ stream: "stderr" as const, text: line })));
  }
  return { lines, exitCode: readExitCode(meta) };
}

function readExitCode(meta: Record<string, unknown> | undefined): number | null {
  if (!meta) return null;
  const candidate = (meta as { exitCode?: unknown; exit_code?: unknown }).exitCode ?? (meta as { exit_code?: unknown }).exit_code;
  if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  if (typeof candidate === "string" && candidate.trim() !== "" && Number.isFinite(Number(candidate))) return Number(candidate);
  return null;
}

export function ArtifactsTab({ room, runId, csrfFetch }: ArtifactsTabProps) {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [terminalById, setTerminalById] = useState<Record<string, TerminalState>>({});

  useEffect(() => {
    setLoading(true);
    csrfFetch(`/artifacts?roomId=${encodeURIComponent(room.id)}`)
      .then((r) => r.json())
      .then((data: { artifacts?: ArtifactSummary[] }) => {
        setArtifacts(Array.isArray(data.artifacts) ? data.artifacts : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [room.id, csrfFetch]);

  useEffect(() => {
    let cancelled = false;
    const terminalArtifacts = artifacts.filter((a) => a.type === "terminal");
    for (const t of terminalArtifacts) {
      if (terminalById[t.id]) continue;
      void (async () => {
        try {
          const filesRes = await csrfFetch(`/artifacts/${encodeURIComponent(t.id)}/files`);
          if (!filesRes.ok) throw new Error(`files ${filesRes.status}`);
          const filesData = (await filesRes.json()) as { files?: Array<{ path: string; updatedAt?: number }> };
          const files = Array.isArray(filesData.files) ? filesData.files : [];
          if (files.length === 0) {
            if (!cancelled) {
              setTerminalById((prev) => ({ ...prev, [t.id]: metadataTerminalState(t.metadata) }));
            }
            return;
          }
          const stderrFile = files.find((f) => /stderr/i.test(f.path));
          const stdoutFile = files.find((f) => /stdout/i.test(f.path));
          const sorted = [...files].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
          const primary = stdoutFile ?? sorted[0]!;

          const fetchLines = async (path: string, defaultStream: "stdout" | "stderr"): Promise<TerminalLine[]> => {
            const res = await csrfFetch(`/artifacts/${encodeURIComponent(t.id)}/files/${encodeURIComponent(path)}`);
            if (!res.ok) return [];
            const text = await res.text();
            return text.split(/\r?\n/).filter((l) => l.length > 0).map((l) => ({ stream: defaultStream, text: l }));
          };

          const out = await fetchLines(primary.path, "stdout");
          let err: TerminalLine[] = [];
          if (stderrFile && stderrFile.path !== primary.path) {
            err = await fetchLines(stderrFile.path, "stderr");
          }
          const merged = [...out, ...err];
          if (!cancelled) {
            setTerminalById((prev) => ({ ...prev, [t.id]: { lines: merged, exitCode: readExitCode(t.metadata) } }));
          }
        } catch {
          if (!cancelled) {
            setTerminalById((prev) => ({ ...prev, [t.id]: metadataTerminalState(t.metadata) }));
          }
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [artifacts, csrfFetch, terminalById]);

  const messages = room.messages.filter((m) => m.runId === runId);
  const cardArtifacts = messages.flatMap((m) =>
    m.parts
      .map((p, i) => ({ id: `${m.id}-${i}`, part: p }))
      .filter(({ part }) => part.type === "card" && (part.card.type === "diff" || part.card.type === "preview"))
  );
  const terminals = artifacts.filter((a) => a.type === "terminal");

  return (
    <div className="flex flex-col gap-3 p-3">
      {loading ? <div className="flex items-center gap-2"><Spinner size="sm" /><span className="text-sm">正在加载产物...</span></div> : null}
      {error ? <Chip size="sm" color="danger" variant="soft">{error}</Chip> : null}
      {cardArtifacts.length === 0 && terminals.length === 0 && !loading ? (
        <p className="text-sm text-muted">这个 Run 暂未生成产物。</p>
      ) : null}
      {cardArtifacts.map(({ id, part }) =>
        part.type === "card" ? <CardRenderer key={id} card={part.card} csrfFetch={csrfFetch} /> : null
      )}
      {terminals.map((t) => {
        const state = terminalById[t.id];
        return (
          <TerminalCard
            key={t.id}
            artifactId={t.id}
            title={t.title || "终端"}
            lines={state?.lines ?? []}
            exitCode={state?.exitCode ?? null}
          />
        );
      })}
      {artifacts.length > 0 ? (
        <Card variant="transparent" className="border border-border">
          <Card.Header>
            <Card.Title className="text-sm">全部产物</Card.Title>
          </Card.Header>
          <Card.Content>
            <ul className="flex flex-col gap-1">
              {artifacts.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-sm">
                  <Chip size="sm" variant="soft" color="default">{a.type}</Chip>
                  <span className="flex-1 truncate">{a.title}</span>
                  <span className="text-xs text-muted">{a.status}</span>
                </li>
              ))}
            </ul>
          </Card.Content>
        </Card>
      ) : null}
    </div>
  );
}
