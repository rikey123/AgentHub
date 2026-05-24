import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import AnsiToHtml from "ansi-to-html";

const ansiConverter = new AnsiToHtml({
  fg: "#e5e7eb",
  bg: "#1f2937",
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
        marginTop: 8,
        borderRadius: 6,
        border: hasError ? "1px solid #ef4444" : "1px solid #e5e7eb",
        overflow: "hidden",
        background: "#1f2937"
      }}
      data-testid="terminal-card"
    >
      <div style={{ padding: "8px 12px", background: "#111827", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", fontFamily: "monospace" }}>Terminal</span>
        {hasError && <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 600 }}>Exit {exitCode}</span>}
      </div>
      <div style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 12, lineHeight: 1.5, color: "#e5e7eb" }}>
        {previewLines.map((line, idx) => (
          <div
            key={idx}
            style={{ color: line.stream === "stderr" ? "#fca5a5" : "#e5e7eb" }}
            dangerouslySetInnerHTML={{ __html: ansiConverter.toHtml(line.text) }}
          />
        ))}
      </div>
      {remaining > 0 && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            width: "100%",
            padding: "6px 12px",
            background: "#374151",
            border: "none",
            borderTop: "1px solid #4b5563",
            cursor: "pointer",
            fontSize: 12,
            color: "#d1d5db",
            fontFamily: "monospace"
          }}
          data-testid="terminal-expand"
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
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24
      }}
      onClick={onClose}
      data-testid="terminal-modal"
    >
      <div
        style={{
          width: "100%",
          maxWidth: 900,
          height: "80vh",
          background: "#1f2937",
          borderRadius: 12,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "12px 16px",
            background: "#111827",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid #374151"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#e5e7eb", fontFamily: "monospace" }}>Terminal Output</span>
            {exitCode !== undefined && (
              <span style={{ fontSize: 11, color: exitCode === 0 ? "#10b981" : "#ef4444", fontWeight: 600 }}>
                Exit {exitCode}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={handleCopy}
              style={{
                padding: "4px 10px",
                borderRadius: 4,
                border: "1px solid #4b5563",
                background: "#374151",
                cursor: "pointer",
                fontSize: 12,
                color: "#d1d5db"
              }}
              data-testid="terminal-copy"
            >
              Copy
            </button>
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 18,
                color: "#9ca3af"
              }}
              aria-label="Close terminal"
            >
              x
            </button>
          </div>
        </div>
        <div style={{ padding: "8px 16px", background: "#1f2937", borderBottom: "1px solid #374151", display: "flex", gap: 8 }}>
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
              padding: "6px 10px",
              borderRadius: 4,
              border: "1px solid #4b5563",
              background: "#111827",
              color: "#e5e7eb",
              fontSize: 12,
              fontFamily: "monospace"
            }}
            data-testid="terminal-search"
          />
          <button
            onClick={handleSearch}
            style={{
              padding: "6px 12px",
              borderRadius: 4,
              border: "1px solid #4b5563",
              background: "#374151",
              cursor: "pointer",
              fontSize: 12,
              color: "#d1d5db"
            }}
          >
            Search
          </button>
        </div>
        <div ref={listRef} style={{ flex: 1, overflow: "auto", padding: "8px 16px", fontFamily: "monospace", fontSize: 12, lineHeight: 1.5 }}>
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
                    color: line.stream === "stderr" ? "#fca5a5" : "#e5e7eb",
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
            padding: "8px 16px",
            background: "#111827",
            borderTop: "1px solid #374151",
            fontSize: 11,
            color: "#9ca3af",
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
