import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import AnsiToHtml from "ansi-to-html";

const ansiConverter = new AnsiToHtml({
  fg: "var(--ah-text-inverse)",
  bg: "var(--ah-bg-inverse)",
  newline: true,
  escapeXML: true,
  stream: false
});

export type TerminalLine = {
  readonly text: string;
  readonly stream: "stdout" | "stderr";
};

type TerminalCardProps = {
  readonly lines: readonly TerminalLine[];
  readonly exitCode?: number | undefined;
  readonly collapsed?: boolean;
};

export function TerminalCard({ lines, exitCode, collapsed = true }: TerminalCardProps) {
  const [expanded, setExpanded] = useState(false);
  const stdoutCount = lines.filter((l) => l.stream === "stdout").length;
  const stderrCount = lines.filter((l) => l.stream === "stderr").length;
  const hasError = exitCode !== undefined && exitCode !== 0;

  if (!collapsed || expanded) {
    return <TerminalExpanded lines={lines} exitCode={exitCode} onClose={() => setExpanded(false)} />;
  }

  const previewLines = lines.slice(0, 10);
  const remaining = lines.length - 10;

  return (
    <div
      style={{
        marginTop: "var(--ah-space-2)",
        borderRadius: "var(--ah-radius-md)",
        border: hasError ? "1px solid var(--ah-danger)" : "1px solid var(--ah-border)",
        overflow: "hidden",
        background: "var(--ah-bg-inverse)"
      }}
      data-testid="terminal-card"
    >
      <div style={{ padding: "var(--ah-space-2) var(--ah-space-3)", background: "var(--ah-bg-primary)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "var(--ah-font-size-xs)", fontWeight: 600, color: "var(--ah-text-muted)", fontFamily: "monospace" }}>Terminal</span>
        {hasError && <span style={{ fontSize: "var(--ah-font-size-xs)", color: "var(--ah-danger)", fontWeight: 600 }}>Exit {exitCode}</span>}
      </div>
      <div style={{ padding: "var(--ah-space-2) var(--ah-space-3)", fontFamily: "monospace", fontSize: "var(--ah-font-size-sm)", lineHeight: "var(--ah-line-height-normal)", color: "var(--ah-text-inverse)" }}>
        {previewLines.map((line, idx) => (
          <div
            key={idx}
            style={{ color: line.stream === "stderr" ? "var(--ah-danger)" : "var(--ah-text-inverse)" }}
            dangerouslySetInnerHTML={{ __html: ansiConverter.toHtml(line.text) }}
          />
        ))}
      </div>
      {remaining > 0 && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            width: "100%",
            padding: "var(--ah-space-2) var(--ah-space-3)",
            background: "var(--ah-bg-secondary)",
            border: "none",
            borderTop: "1px solid var(--ah-border)",
            cursor: "pointer",
            fontSize: "var(--ah-font-size-sm)",
            color: "var(--ah-text-secondary)",
            fontFamily: "monospace"
          }}
          data-testid="terminal-expand"
          aria-label={`Show ${remaining} more lines`}
        >
          Show {remaining} more lines ({stdoutCount} stdout, {stderrCount} stderr)
        </button>
      )}
    </div>
  );
}

function TerminalExpanded({
  lines,
  exitCode,
  onClose
}: {
  readonly lines: readonly TerminalLine[];
  readonly exitCode?: number | undefined;
  readonly onClose: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchRegex, setSearchRegex] = useState<RegExp | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredLines = useMemo(() => {
    if (!searchRegex) return lines;
    return lines.filter((l) => searchRegex.test(l.text));
  }, [lines, searchRegex]);

  const virtualizer = useVirtualizer({
    count: filteredLines.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 20,
    overscan: 10
  });

  useEffect(() => {
    if (autoScroll && listRef.current) {
      virtualizer.scrollToIndex(filteredLines.length - 1, { align: "end" });
    }
  }, [filteredLines.length, autoScroll, virtualizer]);

  const handleSearch = useCallback(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchRegex(null);
      return;
    }
    try {
      setSearchRegex(new RegExp(q, "i"));
    } catch {
      setSearchRegex(null);
    }
  }, [searchQuery]);

  const handleCopy = useCallback(() => {
    const text = filteredLines.map((l) => l.text).join("\n");
    navigator.clipboard.writeText(text).catch(() => {
      // ignore
    });
  }, [filteredLines]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(isAtBottom);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        zIndex: "var(--ah-z-modal)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--ah-space-6)"
      }}
      onClick={onClose}
      data-testid="terminal-modal"
      role="dialog"
      aria-label="Terminal output"
      aria-modal="true"
    >
      <div
        style={{
          width: "100%",
          maxWidth: 900,
          height: "80vh",
          background: "var(--ah-bg-inverse)",
          borderRadius: "var(--ah-radius-xl)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "var(--ah-space-3) var(--ah-space-4)",
            background: "var(--ah-bg-primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--ah-border)"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-3)" }}>
            <span style={{ fontSize: "var(--ah-font-size-base)", fontWeight: 600, color: "var(--ah-text-inverse)", fontFamily: "monospace" }}>Terminal Output</span>
            {exitCode !== undefined && (
              <span style={{ fontSize: "var(--ah-font-size-xs)", color: exitCode === 0 ? "var(--ah-success)" : "var(--ah-danger)", fontWeight: 600 }}>
                Exit {exitCode}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-2)" }}>
            <button
              onClick={handleCopy}
              style={{
                padding: "var(--ah-space-1) var(--ah-space-3)",
                borderRadius: "var(--ah-radius-sm)",
                border: "1px solid var(--ah-border-strong)",
                background: "var(--ah-bg-secondary)",
                cursor: "pointer",
                fontSize: "var(--ah-font-size-sm)",
                color: "var(--ah-text-secondary)"
              }}
              data-testid="terminal-copy"
              aria-label="Copy terminal output"
            >
              Copy
            </button>
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "var(--ah-font-size-lg)",
                color: "var(--ah-text-muted)"
              }}
              aria-label="Close terminal"
            >
              x
            </button>
          </div>
        </div>
        <div style={{ padding: "var(--ah-space-2) var(--ah-space-4)", background: "var(--ah-bg-inverse)", borderBottom: "1px solid var(--ah-border)", display: "flex", gap: "var(--ah-space-2)" }}>
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
            }}
            placeholder="Search (regex supported)"
            style={{
              flex: 1,
              padding: "var(--ah-space-2)",
              borderRadius: "var(--ah-radius-sm)",
              border: "1px solid var(--ah-border-strong)",
              background: "var(--ah-bg-primary)",
              color: "var(--ah-text-inverse)",
              fontSize: "var(--ah-font-size-sm)",
              fontFamily: "monospace"
            }}
            data-testid="terminal-search"
            aria-label="Search terminal output"
          />
          <button
            onClick={handleSearch}
            style={{
              padding: "var(--ah-space-2) var(--ah-space-3)",
              borderRadius: "var(--ah-radius-sm)",
              border: "1px solid var(--ah-border-strong)",
              background: "var(--ah-bg-secondary)",
              cursor: "pointer",
              fontSize: "var(--ah-font-size-sm)",
              color: "var(--ah-text-secondary)"
            }}
            aria-label="Search"
          >
            Search
          </button>
        </div>
        <div ref={listRef} style={{ flex: 1, overflow: "auto", padding: "var(--ah-space-2) var(--ah-space-4)", fontFamily: "monospace", fontSize: "var(--ah-font-size-sm)", lineHeight: "var(--ah-line-height-normal)" }}>
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualItems.map((virtualItem) => {
              const line = filteredLines[virtualItem.index];
              if (!line) return null;
              return (
                <div
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: virtualItem.size,
                    transform: `translateY(${virtualItem.start}px)`,
                    color: line.stream === "stderr" ? "var(--ah-danger)" : "var(--ah-text-inverse)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word"
                  }}
                  dangerouslySetInnerHTML={{ __html: ansiConverter.toHtml(line.text) }}
                />
              );
            })}
          </div>
        </div>
        <div
          style={{
            padding: "var(--ah-space-2) var(--ah-space-4)",
            background: "var(--ah-bg-primary)",
            borderTop: "1px solid var(--ah-border)",
            fontSize: "var(--ah-font-size-xs)",
            color: "var(--ah-text-muted)",
            fontFamily: "monospace",
            display: "flex",
            justifyContent: "space-between"
          }}
        >
          <span>
            {filteredLines.length} / {lines.length} lines
          </span>
          <span>{autoScroll ? "Auto-scroll on" : "Auto-scroll off"}</span>
        </div>
      </div>
    </div>
  );
}
