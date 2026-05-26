import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Input, SearchField, Kbd } from "@heroui/react";

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

export function CommandPalette({ isOpen, onOpenChange, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

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

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setHighlight(0);
    }
  }, [isOpen]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container placement="top" size="md">
        <Modal.Dialog className="mt-16">
          <Modal.Body className="p-2">
            <SearchField aria-label="Command palette" autoFocus value={query} onChange={setQuery}>
              <Input
                placeholder="Type a command or search…"
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
            <ul
              ref={listRef}
              role="listbox"
              aria-label="Commands"
              className="mt-2 max-h-[60vh] overflow-auto"
              aria-activedescendant={filtered[highlight] ? `palette-${filtered[highlight].id}` : undefined}
            >
              {filtered.length === 0 ? (
                <li className="p-4 text-center text-sm text-muted">No matches.</li>
              ) : null}
              {groupBy(filtered).map(([group, cmds]) => (
                <li key={group}>
                  <div className="px-2 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{group}</div>
                  <ul role="group">
                    {cmds.map((cmd) => {
                      const idx = filtered.indexOf(cmd);
                      const active = idx === highlight;
                      return (
                        <li
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
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
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
