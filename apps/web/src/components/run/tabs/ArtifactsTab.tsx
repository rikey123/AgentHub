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
};

export function ArtifactsTab({ room, runId, csrfFetch }: ArtifactsTabProps) {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

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

  const messages = room.messages.filter((m) => m.runId === runId);
  const cardArtifacts = messages.flatMap((m) =>
    m.parts
      .map((p, i) => ({ id: `${m.id}-${i}`, part: p }))
      .filter(({ part }) => part.type === "card" && (part.card.type === "diff" || part.card.type === "preview"))
  );
  const terminals = artifacts.filter((a) => a.type === "terminal");

  return (
    <div className="flex flex-col gap-3 p-3">
      {loading ? <div className="flex items-center gap-2"><Spinner size="sm" /><span className="text-sm">Loading artifacts…</span></div> : null}
      {error ? <Chip size="sm" color="danger" variant="soft">{error}</Chip> : null}
      {cardArtifacts.length === 0 && terminals.length === 0 && !loading ? (
        <p className="text-sm text-muted">No artifacts produced by this run.</p>
      ) : null}
      {cardArtifacts.map(({ id, part }) =>
        part.type === "card" ? <CardRenderer key={id} card={part.card} csrfFetch={csrfFetch} /> : null
      )}
      {terminals.map((t) => (
        <TerminalCard key={t.id} artifactId={t.id} title={t.title || "Terminal"} lines={[]} />
      ))}
      {artifacts.length > 0 ? (
        <Card variant="transparent" className="border border-border">
          <Card.Header>
            <Card.Title className="text-sm">All artifacts</Card.Title>
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
