import { Tooltip } from "@heroui/react";

export type RailItem = "chat" | "runs" | "tasks" | "context" | "artifacts" | "settings";

interface FeatureRailProps {
  active: RailItem;
  onSelect: (item: RailItem) => void;
  onOpenSettings?: () => void;
}

const items: Array<{ key: RailItem; label: string; glyph: string }> = [
  { key: "chat", label: "Chat", glyph: "CH" },
  { key: "runs", label: "Runs", glyph: "RN" },
  { key: "tasks", label: "Tasks", glyph: "TS" },
  { key: "context", label: "Context", glyph: "CX" },
  { key: "artifacts", label: "Artifacts", glyph: "AR" },
  { key: "settings", label: "Settings", glyph: "SE" }
];

export function FeatureRail({ active, onSelect, onOpenSettings }: FeatureRailProps) {
  return (
    <nav
      aria-label="Workbench navigation"
      className="flex h-full flex-col items-center gap-2 bg-[linear-gradient(180deg,var(--surface),var(--surface-tertiary))] px-2 py-3"
    >
      <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-accent text-sm font-black text-accent-foreground shadow-[0_12px_26px_color-mix(in_oklab,var(--accent)_28%,transparent)]">
        AH
      </div>

      <div className="flex flex-1 flex-col items-center gap-1">
        {items.map((item) => {
          const isSettings = item.key === "settings";
          const isActive = item.key === active;
          return (
            <Tooltip key={item.key}>
              <Tooltip.Trigger>
                <button
                  type="button"
                  aria-label={item.label}
                  aria-current={isActive && !isSettings ? "page" : undefined}
                  onClick={() => {
                    if (isSettings) {
                      onOpenSettings?.();
                      return;
                    }
                    onSelect(item.key);
                  }}
                  className={[
                    "relative flex h-10 w-10 items-center justify-center rounded-2xl text-[11px] font-bold tracking-tight transition-all",
                    isActive
                      ? "bg-accent-soft text-accent-soft-foreground shadow-sm"
                      : "text-muted hover:bg-default hover:text-foreground"
                  ].join(" ")}
                >
                  {isActive ? <span className="absolute -left-2 h-5 w-1 rounded-full bg-accent" aria-hidden="true" /> : null}
                  <span aria-hidden="true">{item.glyph}</span>
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content>{item.label}</Tooltip.Content>
            </Tooltip>
          );
        })}
      </div>

      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-overlay text-[10px] font-semibold text-muted shadow-sm">
        v1.0
      </div>
    </nav>
  );
}
