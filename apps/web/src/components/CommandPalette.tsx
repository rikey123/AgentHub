import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Input, SearchField, Kbd } from "@heroui/react";
import { useVirtualizer } from "@tanstack/react-virtual";

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  group: string;
  keywords?: string[];
  shortcut?: string;
  perform: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  commands: PaletteCommand[];
}

type Row =
  | { kind: "header"; group: string }
  | { kind: "command"; cmd: PaletteCommand; cmdIndex: number };

export function CommandPalette({ isOpen, onOpenChange, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    const tokens = q.split(/\s+/).filter(Boolean);
    return commands.filter((c) => {
      const haystack = [
        c.label.toLowerCase(),
        c.group.toLowerCase(),
        ...(c.keywords ?? []).map((k) => k.toLowerCase())
      ].join(" ");
      return tokens.every((t) => haystack.includes(t));
    });
  }, [query, commands]);

  const grouped = useMemo(() => groupBy(filtered), [filtered]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let cmdIndex = 0;
    for (const [group, cmds] of grouped) {
      out.push({ kind: "header", group });
      for (const cmd of cmds) {
        out.push({ kind: "command", cmd, cmdIndex });
        cmdIndex++;
      }
    }
    return out;
  }, [grouped]);

  const virtualize = filtered.length > 20;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (i) => (rows[i]?.kind === "header" ? 28 : 32),
    overscan: 8
  });

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setHighlight(0);
    }
  }, [isOpen]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  // Auto-scroll virtualized highlight into view.
  useEffect(() => {
    if (!virtualize) return;
    const targetCmd = filtered[highlight];
    if (!targetCmd) return;
    const rowIndex = rows.findIndex((r) => r.kind === "command" && r.cmd.id === targetCmd.id);
    if (rowIndex >= 0) virtualizer.scrollToIndex(rowIndex, { align: "auto" });
  }, [highlight, virtualize, filtered, rows, virtualizer]);

  const renderCommand = (cmd: PaletteCommand, idx: number) => {
    const active = idx === highlight;
    return (
      <div
        key={cmd.id}
        id={`palette-${cmd.id}`}
        role="option"
        aria-selected={active}
        onMouseEnter={() => setHighlight(idx)}
        onClick={() => {
          cmd.perform();
          onOpenChange(false);
        }}
        className={[
          "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
          active ? "bg-accent-soft text-accent-soft-foreground" : "hover:bg-default"
        ].join(" ")}
      >
        <span className="flex-1 truncate">{cmd.label}</span>
        {cmd.hint ? <span className="text-xs text-muted">{cmd.hint}</span> : null}
        {cmd.shortcut ? <Kbd>{cmd.shortcut}</Kbd> : null}
      </div>
    );
  };

  const activeId = filtered[highlight] ? `palette-${filtered[highlight]!.id}` : undefined;

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container placement="top" size="md">
        <Modal.Dialog className="mt-16" aria-label="命令面板">
          <Modal.Body className="p-2">
            <SearchField aria-label="命令面板" autoFocus value={query} onChange={setQuery}>
              <Input
                placeholder="输入命令或搜索..."
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlight((h) => Math.min(filtered.length - 1, h + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlight((h) => Math.max(0, h - 1));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const cmd = filtered[highlight];
                    if (cmd) {
                      cmd.perform();
                      onOpenChange(false);
                    }
                  } else if (e.key === "Escape") {
                    onOpenChange(false);
                  } else if (e.key === "Home") {
                    setHighlight(0);
                  } else if (e.key === "End") {
                    setHighlight(Math.max(0, filtered.length - 1));
                  }
                }}
              />
            </SearchField>
            <div
              ref={listRef}
              role="listbox"
              aria-label="命令列表"
              className="mt-2 max-h-[60vh] overflow-auto"
              aria-activedescendant={activeId}
              tabIndex={0}
            >
              {filtered.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted">无匹配结果。</div>
              ) : virtualize ? (
                <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}>
                  {virtualizer.getVirtualItems().map((vi) => {
                    const row = rows[vi.index]!;
                    return (
                      <div
                        key={vi.key}
                        data-index={vi.index}
                        ref={virtualizer.measureElement}
                        style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)` }}
                      >
                        {row.kind === "header" ? (
                          <div className="px-2 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{row.group}</div>
                        ) : (
                          renderCommand(row.cmd, row.cmdIndex)
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                grouped.map(([group, cmds]) => (
                  <div key={group}>
                    <div className="px-2 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{group}</div>
                    <div role="group">
                      {cmds.map((cmd) => renderCommand(cmd, filtered.indexOf(cmd)))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function groupBy(commands: PaletteCommand[]): Array<[string, PaletteCommand[]]> {
  const map = new Map<string, PaletteCommand[]>();
  for (const c of commands) {
    const list = map.get(c.group) ?? [];
    list.push(c);
    map.set(c.group, list);
  }
  return Array.from(map.entries());
}
