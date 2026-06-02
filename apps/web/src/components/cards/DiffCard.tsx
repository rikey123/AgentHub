import { useState } from "react";
import { Button, Card, Chip, DisclosureGroup, Disclosure } from "@heroui/react";
import type { Card as ProtocolCard } from "@agenthub/protocol/domains";

type DiffCardData = Extract<ProtocolCard, { type: "diff" }>;

interface DiffCardProps {
  card: DiffCardData;
  csrfFetch: typeof fetch;
}

export function DiffCard({ card, csrfFetch }: DiffCardProps) {
  const [pending, setPending] = useState<"apply" | "reject" | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const totalAdditions = card.files.reduce((acc, f) => acc + (f.additions ?? 0), 0);
  const totalDeletions = card.files.reduce((acc, f) => acc + (f.deletions ?? 0), 0);
  const isResolved = ["applied", "rejected", "failed"].includes(String(card.applyStatus));

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
        <DisclosureGroup defaultExpandedKeys={["files"]}>
          <Disclosure id="files">
            <Disclosure.Trigger>
              <span className="text-sm font-medium">Files</span>
            </Disclosure.Trigger>
            <Disclosure.Body>
              <ul className="flex flex-col gap-1 py-1 text-sm">
                {card.files.map((file) => (
                  <li key={file.path} id={`artifact-file-${encodeURIComponent(card.artifactId)}-${encodeURIComponent(file.path)}`} className="flex items-center gap-2">
                    <Chip size="sm" variant="soft" color={
                      file.status === "added" ? "success" :
                      file.status === "deleted" ? "danger" : "warning"
                    }>{file.status}</Chip>
                    <span className="ah-mono truncate flex-1">{file.path}</span>
                    <span className="text-xs text-muted">+{file.additions} -{file.deletions}</span>
                  </li>
                ))}
              </ul>
            </Disclosure.Body>
          </Disclosure>
        </DisclosureGroup>
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
