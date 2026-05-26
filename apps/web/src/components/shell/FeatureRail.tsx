import { Tooltip } from "@heroui/react";

export type RailItem = "chat" | "runs" | "tasks" | "context" | "artifacts" | "settings";

interface FeatureRailProps {
  active: RailItem;
  onSelect: (item: RailItem) => void;
}

const items: Array<{ key: RailItem; label: string; glyph: string; disabled?: boolean }> = [
  { key: "chat", label: "Chat", glyph: "💬" },
  { key: "runs", label: "Runs", glyph: "▶" },
  { key: "tasks", label: "Tasks", glyph: "✓" },
  { key: "context", label: "Context", glyph: "▤" },
  { key: "artifacts", label: "Artifacts", glyph: "◇" },
  { key: "settings", label: "Settings", glyph: "⚙" }
];

export function FeatureRail({ active, onSelect }: FeatureRailProps) {
  return (
    <nav aria-label="Workbench navigation" className="flex h-full flex-col items-center py-3 gap-1">
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <Tooltip key={item.key}>
            <Tooltip.Trigger>
              <button
                type="button"
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                onClick={() => onSelect(item.key)}
                className={[
                  "flex h-10 w-10 items-center justify-center rounded-lg text-lg transition-colors",
                  isActive
                    ? "bg-accent-soft text-accent-soft-foreground"
                    : "text-muted hover:bg-default hover:text-foreground"
                ].join(" ")}
              >
                <span aria-hidden="true">{item.glyph}</span>
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content>{item.label}</Tooltip.Content>
          </Tooltip>
        );
      })}
    </nav>
  );
}
