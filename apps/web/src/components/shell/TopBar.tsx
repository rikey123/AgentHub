import { Button, Kbd, Tooltip } from "@heroui/react";
import type { Theme } from "../../hooks/useTheme.ts";

type ConnectionStatus = "connected" | "connecting" | "reconnecting" | "offline" | "disconnected";

const connectionDotClass = (status: ConnectionStatus): string => {
  switch (status) {
    case "connected":
      return "bg-success";
    case "connecting":
    case "reconnecting":
      return "bg-warning";
    case "offline":
    case "disconnected":
    default:
      return "bg-danger";
  }
};

const connectionLabel = (status: ConnectionStatus): string => {
  switch (status) {
    case "connected":
      return "已连接";
    case "connecting":
      return "连接中";
    case "reconnecting":
      return "重新连接中";
    case "offline":
      return "已离线";
    case "disconnected":
    default:
      return "未连接";
  }
};

interface TopBarProps {
  connectionStatus: ConnectionStatus;
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

const themeLabel = (t: Theme): string => {
  switch (t) {
    case "light":
      return "浅色";
    case "dark":
      return "深色";
    case "auto":
    default:
      return "自动";
  }
};

export function TopBar(props: TopBarProps) {
  return (
    <div className="flex w-full items-center gap-3 px-3">
      <a className="ah-sr-only" href="#agenthub-workbench-main">跳转到工作台</a>

      <Tooltip>
        <Button isIconOnly variant="ghost" size="sm" onPress={props.onToggleLeft} aria-label="切换 rooms 面板">
          ☰
        </Button>
        <Tooltip.Content>{props.leftCollapsed ? "显示 rooms" : "隐藏 rooms"}</Tooltip.Content>
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

      <Tooltip>
        <Tooltip.Trigger>
          <span
            role="status"
            aria-label={`连接状态：${connectionLabel(props.connectionStatus)}`}
            className="mr-1 flex h-5 w-5 items-center justify-center"
          >
            <span
              className={[
                "h-2.5 w-2.5 rounded-full",
                connectionDotClass(props.connectionStatus),
                props.connectionStatus === "connecting" || props.connectionStatus === "reconnecting"
                  ? "animate-pulse"
                  : ""
              ].join(" ")}
              aria-hidden="true"
            />
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content>{connectionLabel(props.connectionStatus)}</Tooltip.Content>
      </Tooltip>

      <Tooltip>
        <Button variant="ghost" size="sm" onPress={props.onOpenCommandPalette} aria-label="打开命令面板">
          <Kbd>⌘K</Kbd>
        </Button>
        <Tooltip.Content>命令面板</Tooltip.Content>
      </Tooltip>

      <Tooltip>
        <Button isIconOnly variant="ghost" size="sm" onPress={props.onOpenKeymap} aria-label="显示键盘快捷键">
          ?
        </Button>
        <Tooltip.Content>键盘快捷键</Tooltip.Content>
      </Tooltip>

      <Tooltip>
        <Button isIconOnly variant="ghost" size="sm" onPress={props.onCycleTheme} aria-label={`主题：${themeLabel(props.theme)}`}>
          {themeIcon(props.theme)}
        </Button>
        <Tooltip.Content>主题：{themeLabel(props.theme)}</Tooltip.Content>
      </Tooltip>

      <Tooltip>
        <Button isIconOnly variant="ghost" size="sm" onPress={props.onToggleRight} aria-label="切换工作台面板">
          ⊟
        </Button>
        <Tooltip.Content>{props.rightCollapsed ? "显示工作台" : "隐藏工作台"}</Tooltip.Content>
      </Tooltip>
    </div>
  );
}
