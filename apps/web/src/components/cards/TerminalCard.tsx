import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Chip, Modal, ScrollShadow, SearchField, Input, Switch } from "@heroui/react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface TerminalCardProps {
  artifactId: string;
  title: string;
  lines: ReadonlyArray<{ stream: "stdout" | "stderr"; text: string }>;
}

export function TerminalCard({ artifactId, title, lines }: TerminalCardProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <Card variant="default">
        <Card.Header>
          <div className="flex items-center gap-2">
            <Card.Title className="flex-1 truncate">{title}</Card.Title>
            <Chip size="sm" variant="soft" color="default">{lines.length} lines</Chip>
          </div>
          <Card.Description className="ah-mono truncate">{artifactId}</Card.Description>
        </Card.Header>
        <Card.Content>
          <div className="ah-mono max-h-32 overflow-hidden rounded bg-surface-secondary p-2 text-xs leading-tight">
            {lines.slice(-6).map((line, i) => (
              <div key={i} className={line.stream === "stderr" ? "text-danger" : ""}>
                {line.text}
              </div>
            ))}
          </div>
        </Card.Content>
        <Card.Footer>
          <Button variant="secondary" onPress={() => setExpanded(true)}>Expand</Button>
        </Card.Footer>
      </Card>
      {expanded ? (
        <Modal.Backdrop isOpen={expanded} onOpenChange={setExpanded}>
          <Modal.Container size="lg">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>{title}</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <ExpandedTerminal lines={lines} />
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="secondary">Close</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      ) : null}
    </>
  );
}

function ExpandedTerminal({ lines }: { lines: TerminalCardProps["lines"] }) {
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const parentRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return lines;
    try {
      const re = new RegExp(search, "i");
      return lines.filter((l) => re.test(l.text));
    } catch {
      return lines.filter((l) => l.text.toLowerCase().includes(search.toLowerCase()));
    }
  }, [lines, search]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 18,
    overscan: 30
  });

  useEffect(() => {
    if (autoScroll && parentRef.current && filtered.length > 0) {
      virtualizer.scrollToIndex(filtered.length - 1);
    }
  }, [autoScroll, filtered.length, virtualizer]);

  const copyAll = () => {
    void navigator.clipboard.writeText(filtered.map((l) => l.text).join("\n"));
  };

  return (
    <div className="flex h-[60vh] flex-col gap-2">
      <div className="flex items-center gap-2">
        <SearchField className="flex-1" aria-label="Search lines" value={search} onChange={setSearch}>
          <Input placeholder="Filter (regex)" />
        </SearchField>
        <Switch isSelected={autoScroll} onChange={setAutoScroll}>Auto-scroll</Switch>
        <Button size="sm" variant="secondary" onPress={copyAll}>Copy all</Button>
      </div>
      <div ref={parentRef} className="ah-mono flex-1 overflow-auto rounded bg-surface-secondary p-2 text-xs leading-tight">
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const line = filtered[vi.index]!;
            return (
              <div
                key={vi.key}
                className={line.stream === "stderr" ? "text-danger" : undefined}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${vi.start}px)`,
                  height: vi.size
                }}
              >
                {line.text}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
