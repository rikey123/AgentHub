import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Chip, Modal, SearchField, Input, Spinner, Switch } from "@heroui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Convert from "ansi-to-html";

interface TerminalCardProps {
  artifactId: string;
  title: string;
  lines: ReadonlyArray<{ stream: "stdout" | "stderr"; text: string }>;
  exitCode?: number | null;
}

const ansi = new Convert({ newline: false, escapeXML: true });

function renderHtml(text: string): string {
  try {
    return ansi.toHtml(text);
  } catch {
    return text.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
  }
}

export function TerminalCard({ artifactId, title, lines, exitCode = null }: TerminalCardProps) {
  const [expanded, setExpanded] = useState(false);
  const stdoutCount = lines.filter((l) => l.stream === "stdout").length;
  const stderrCount = lines.filter((l) => l.stream === "stderr").length;
  const showSpinner = lines.length === 0 && Boolean(artifactId);
  const showExitBadge = exitCode !== null && exitCode !== undefined && exitCode !== 0;

  return (
    <>
      <Card variant="default">
        <Card.Header>
          <div className="flex items-center gap-2">
            <Card.Title className="flex-1 truncate">{title}</Card.Title>
            {showExitBadge ? (
              <Chip size="sm" color="danger" variant="primary">退出码 {exitCode}</Chip>
            ) : null}
            <Chip size="sm" variant="soft" color="default">{lines.length} 行</Chip>
          </div>
          <Card.Description className="ah-mono truncate">{artifactId}</Card.Description>
        </Card.Header>
        <Card.Content>
          <div className="ah-mono max-h-48 overflow-hidden rounded bg-surface-secondary p-2 text-xs leading-tight">
            {showSpinner ? (
              <div className="flex items-center gap-2 text-muted">
                <Spinner size="sm" />
                <span>正在加载...</span>
              </div>
            ) : lines.length === 0 ? (
              <div className="text-muted">暂无输出。</div>
            ) : (
              lines.slice(-10).map((line, i) => (
                <div
                  key={i}
                  className={line.stream === "stderr" ? "text-danger" : ""}
                  dangerouslySetInnerHTML={{ __html: renderHtml(line.text) }}
                />
              ))
            )}
          </div>
        </Card.Content>
        <Card.Footer>
          <div className="flex items-center gap-2">
            <Chip size="sm" variant="soft" color="default">stdout {stdoutCount}</Chip>
            <Chip size="sm" variant="soft" color={stderrCount > 0 ? "danger" : "default"}>stderr {stderrCount}</Chip>
            <div className="ml-auto">
              <Button variant="secondary" onPress={() => setExpanded(true)} isDisabled={lines.length === 0} data-testid="terminal-expand">
                展开
              </Button>
            </div>
          </div>
        </Card.Footer>
      </Card>
      {expanded ? (
        <Modal.Backdrop isOpen={expanded} onOpenChange={setExpanded}>
          <Modal.Container size="lg">
            <Modal.Dialog data-testid="terminal-modal">
              <Modal.CloseTrigger aria-label="关闭终端" />
              <Modal.Header>
                <Modal.Heading>{title}</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <ExpandedTerminal lines={lines} />
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="secondary">关闭</Button>
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
        <SearchField className="flex-1" aria-label="搜索日志行" value={search} onChange={setSearch}>
          <Input placeholder="筛选（正则）" data-testid="terminal-search" />
        </SearchField>
        <Switch isSelected={autoScroll} onChange={setAutoScroll}>自动滚动</Switch>
        <Button size="sm" variant="secondary" onPress={copyAll} data-testid="terminal-copy">复制全部</Button>
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
                dangerouslySetInnerHTML={{ __html: renderHtml(line.text) }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
