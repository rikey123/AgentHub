import { Button, Tooltip } from "@heroui/react";
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

const connectionToneClass = (status: ConnectionStatus): string => {
  switch (status) {
    case "connected":
      return "ah-topbar-status-success";
    case "connecting":
    case "reconnecting":
      return "ah-topbar-status-warning";
    case "offline":
    case "disconnected":
    default:
      return "ah-topbar-status-danger";
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
  onOpenMobilePairing: () => void;
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
    <div className="ah-topbar flex w-full items-center gap-3 px-3">
      <a className="ah-sr-only" href="#agenthub-workbench-main">跳转到工作台</a>

      <Tooltip>
        <Button className="ah-topbar-icon-button" isIconOnly variant="ghost" size="sm" onPress={props.onToggleLeft} aria-label="切换 rooms 面板">
          ☰
        </Button>
        <Tooltip.Content>{props.leftCollapsed ? "显示 rooms" : "隐藏 rooms"}</Tooltip.Content>
      </Tooltip>

      <div className="ah-topbar-brand min-w-0">
        <span className="ah-topbar-brand-dot" aria-hidden="true" />
        <span className="ah-topbar-brand-name">AgentHub</span>
        {props.roomTitle ? (
          <>
            <span className="ah-topbar-separator">/</span>
            <span className="ah-topbar-room-title">{props.roomTitle}</span>
          </>
        ) : null}
      </div>

      <div className="flex-1" aria-live="polite" />

      <div className="ah-topbar-actions">
        <Tooltip>
          <Tooltip.Trigger>
            <span
              role="status"
              aria-label={`连接状态：${connectionLabel(props.connectionStatus)}`}
              className={["ah-topbar-status", connectionToneClass(props.connectionStatus)].join(" ")}
            >
              <span
                className={[
                  "ah-topbar-status-dot",
                  connectionDotClass(props.connectionStatus),
                  props.connectionStatus === "connecting" || props.connectionStatus === "reconnecting"
                    ? "animate-pulse"
                    : ""
                ].join(" ")}
                aria-hidden="true"
              />
              <span>{connectionLabel(props.connectionStatus)}</span>
            </span>
          </Tooltip.Trigger>
          <Tooltip.Content>{connectionLabel(props.connectionStatus)}</Tooltip.Content>
        </Tooltip>

        <div className="ah-topbar-tool-group">
          <Tooltip>
            <Button className="ah-topbar-command-button" variant="ghost" size="sm" onPress={props.onOpenCommandPalette} aria-label="打开命令面板">
              <span className="ah-topbar-search-icon" aria-hidden="true" />
              <span className="ah-topbar-search-placeholder">搜索....</span>
            </Button>
            <Tooltip.Content>命令面板</Tooltip.Content>
          </Tooltip>

          <div className="ah-topbar-icon-group">
            <Tooltip>
              <Button className="ah-topbar-icon-button" isIconOnly variant="ghost" size="sm" onPress={props.onOpenMobilePairing} aria-label="移动端验证">
                📱
              </Button>
              <Tooltip.Content>移动端验证</Tooltip.Content>
            </Tooltip>

            <Tooltip>
              <Button className="ah-topbar-icon-button" isIconOnly variant="ghost" size="sm" onPress={props.onOpenKeymap} aria-label="显示键盘快捷键">
                ?
              </Button>
              <Tooltip.Content>键盘快捷键</Tooltip.Content>
            </Tooltip>

            <Tooltip>
              <Button className="ah-topbar-icon-button" isIconOnly variant="ghost" size="sm" onPress={props.onCycleTheme} aria-label={`主题：${themeLabel(props.theme)}`}>
                {themeIcon(props.theme)}
              </Button>
              <Tooltip.Content>主题：{themeLabel(props.theme)}</Tooltip.Content>
            </Tooltip>

            <Tooltip>
              <Button className="ah-topbar-icon-button" isIconOnly variant="ghost" size="sm" onPress={props.onToggleRight} aria-label="切换工作台面板">
                ⊟
              </Button>
              <Tooltip.Content>{props.rightCollapsed ? "显示工作台" : "隐藏工作台"}</Tooltip.Content>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}
