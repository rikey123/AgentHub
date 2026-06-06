import { useEffect, useState } from "react";
import { Button, Card, Chip } from "@heroui/react";
import type { Card as ProtocolCard } from "@agenthub/protocol/domains";
import { DiffReviewViewer, type ReviewFile } from "../artifacts/DiffReviewViewer.tsx";

type DiffCardData = Extract<ProtocolCard, { type: "diff" }>;

interface DiffCardProps {
  card: DiffCardData;
  csrfFetch: typeof fetch;
}

export function DiffCard({ card, csrfFetch }: DiffCardProps) {
  const [pending, setPending] = useState<"apply" | "reject" | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [files, setFiles] = useState<ReviewFile[] | undefined>(undefined);
  const [filesError, setFilesError] = useState<string | undefined>(undefined);

  const totalAdditions = card.files.reduce((acc, f) => acc + (f.additions ?? 0), 0);
  const totalDeletions = card.files.reduce((acc, f) => acc + (f.deletions ?? 0), 0);
  const isResolved = ["applied", "rejected", "failed"].includes(String(card.applyStatus));
  const fallbackFiles: ReviewFile[] = card.files.map((file) => ({
    path: file.path,
    fileStatus: file.status,
    additions: file.additions,
    deletions: file.deletions
  }));

  useEffect(() => {
    let cancelled = false;
    setFiles(undefined);
    setFilesError(undefined);
    void csrfFetch(`/artifacts/${encodeURIComponent(card.artifactId)}/files`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`files ${res.status}`);
        return res.json() as Promise<{ readonly files?: ReviewFile[] }>;
      })
      .then((body) => {
        if (cancelled) return;
        setFiles(Array.isArray(body.files) ? body.files : []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setFilesError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [card.artifactId, csrfFetch]);

  const act = async (action: "apply" | "reject") => {
    setPending(action);
    setError(undefined);
    try {
      const res = await csrfFetch(`/artifacts/${encodeURIComponent(card.artifactId)}/${action}`, {
        method: "POST",
        body: JSON.stringify({})
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(undefined);
    }
  };

  return (
    <Card variant="default">
      <Card.Header>
        <div className="flex items-center gap-2">
          <Card.Title>Diff · {card.files.length} file{card.files.length === 1 ? "" : "s"}</Card.Title>
          <Chip size="sm" variant="soft" color="default">{String(card.applyStatus)}</Chip>
        </div>
        <Card.Description>
          <span className="text-success">+{totalAdditions}</span>{" "}
          <span className="text-danger">-{totalDeletions}</span>
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <DiffReviewViewer artifactId={card.artifactId} files={files && files.length > 0 ? files : fallbackFiles} compact />
        {filesError ? <p className="mt-2 text-xs text-warning-700 dark:text-warning-200">Diff preview unavailable: {filesError}</p> : null}
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      </Card.Content>
      {!isResolved ? (
        <Card.Footer className="gap-2">
          <Button variant="primary" isPending={pending === "apply"} onPress={() => act("apply")}>Apply</Button>
          <Button variant="danger" isPending={pending === "reject"} onPress={() => act("reject")}>Reject</Button>
        </Card.Footer>
      ) : null}
    </Card>
  );
}
