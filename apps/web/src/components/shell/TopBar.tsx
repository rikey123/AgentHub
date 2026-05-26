import { Button, Chip, Kbd, Tooltip } from "@heroui/react";
import type { Theme } from "../../hooks/useTheme.ts";
import { connectionColor } from "../../lib/status.ts";

interface TopBarProps {
  connectionStatus: "connected" | "connecting" | "reconnecting" | "offline" | "disconnected";
  connectionError?: string | undefined;
  roomTitle?: string | undefined;
  theme: Theme;
  onCycleTheme: () => void;
  onOpenCommandPalette: () => void;
  onOpenKeymap: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

const themeIcon = (t: Theme) => t === "dark" ? "🌙" : t === "light" ? "☀️" : "🌓";

export function TopBar(props: TopBarProps) {
  return (
    <div className="flex w-full items-center gap-3 px-3">
      <a className="ah-sr-only" href="#agenthub-workbench-main">Skip to workbench</a>

      <Tooltip>
        <Button isIconOnly variant="ghost" size="sm" onPress={props.onToggleLeft} aria-label="Toggle rooms panel">
          ☰
        </Button>
        <Tooltip.Content>{props.leftCollapsed ? "Show rooms" : "Hide rooms"}</Tooltip.Content>
      </Tooltip>

      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-accent">●</span>
        <span>AgentHub</span>
        {props.roomTitle ? (
          <>
            <span className="text-muted">/</span>
            <span className="text-muted truncate max-w-[280px]">{props.roomTitle}</span>
          </>
        ) : null}
      </div>

      <div className="flex-1" aria-live="polite" />

      <Chip
        size="sm"
        variant="soft"
        color={connectionColor(props.connectionStatus)}
        aria-label={`Connection: ${props.connectionStatus}`}
      >
        {props.connectionStatus}
      </Chip>

      <Tooltip>
        <Button variant="ghost" size="sm" onPress={props.onOpenCommandPalette} aria-label="Open command palette">
          <span className="hidden sm:inline">Command</span>
          <Kbd className="ml-2">⌘K</Kbd>
        </Button>
        <Tooltip.Content>Command palette</Tooltip.Content>
      </Tooltip>

      <Tooltip>
        <Button isIconOnly variant="ghost" size="sm" onPress={props.onOpenKeymap} aria-label="Show keymap">
          ?
        </Button>
        <Tooltip.Content>Keyboard shortcuts</Tooltip.Content>
      </Tooltip>

      <Tooltip>
        <Button isIconOnly variant="ghost" size="sm" onPress={props.onCycleTheme} aria-label={`Theme: ${props.theme}`}>
          {themeIcon(props.theme)}
        </Button>
        <Tooltip.Content>Theme: {props.theme}</Tooltip.Content>
      </Tooltip>

      <Tooltip>
        <Button isIconOnly variant="ghost" size="sm" onPress={props.onToggleRight} aria-label="Toggle workbench panel">
          ⊟
        </Button>
        <Tooltip.Content>{props.rightCollapsed ? "Show workbench" : "Hide workbench"}</Tooltip.Content>
      </Tooltip>
    </div>
  );
}
