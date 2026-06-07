import type React from "react";
import { Tooltip } from "@heroui/react";

export type RailItem = "chat" | "contacts" | "runs" | "tasks" | "context" | "artifacts" | "settings";

interface FeatureRailProps {
  active: RailItem;
  onSelect: (item: RailItem) => void;
  onOpenSettings?: () => void;
}

// 顶部 AH logo 换成房子图标（实心，与图里工作台一致）
function IconHome({ filled }: { filled?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12L12 4l9 8" />
      <path d="M9 21V12h6v9" />
      <path d="M5 10v11h14V10" />
      {filled && <path d="M3 12L12 4l9 8v9H3z" fill="currentColor" stroke="none" opacity="0.15" />}
    </svg>
  );
}

// 主 logo — 小机器人头
function IconRobot() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="3" x2="12" y2="5.5" />
      <circle cx="12" cy="2.5" r="1" fill="currentColor" stroke="none" />
      <rect x="4.5" y="5.5" width="15" height="12" rx="3" />
      <circle cx="9" cy="11.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="11.5" r="1.5" fill="currentColor" stroke="none" />
      <line x1="2.5" y1="10" x2="2.5" y2="14" />
      <line x1="21.5" y1="10" x2="21.5" y2="14" />
    </svg>
  );
}

// runs — 盾牌内有圆圈（类似图里的运行图标）
function IconRuns() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconContacts() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20a6.5 6.5 0 0 1 13 0" />
      <circle cx="17" cy="10" r="2.5" />
      <path d="M15.5 15.5c2.8.4 5 2 5.5 4.5" />
    </svg>
  );
}

// tasks — 三行列表，每行前有圆点
function IconTasks() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="5" cy="7" r="1.5" fill="currentColor" stroke="none" />
      <line x1="9" y1="7" x2="20" y2="7" />
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <circle cx="5" cy="17" r="1.5" fill="currentColor" stroke="none" />
      <line x1="9" y1="17" x2="20" y2="17" />
    </svg>
  );
}

// context — 摊开的书
function IconContext() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2" />
      <path d="M12 6.5C13.5 5 16 4.5 20 4.5v13c-4 0-6.5.5-8 2z" />
      <line x1="12" y1="6.5" x2="12" y2="19.5" />
    </svg>
  );
}

// artifacts — 文件+内容线条（与 context 区分，加横线）
function IconArtifacts() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}

// settings — 齿轮
function IconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

const ICONS: Record<RailItem, React.ReactNode> = {
  chat: <IconHome />,
  contacts: <IconContacts />,
  runs: <IconRuns />,
  tasks: <IconTasks />,
  context: <IconContext />,
  artifacts: <IconArtifacts />,
  settings: <IconSettings />
};

const items: Array<{ key: RailItem; label: string; cn: string }> = [
  { key: "chat", label: "Chat", cn: "聊天" },
  { key: "contacts", label: "Contacts", cn: "联系人" },
  { key: "runs", label: "Runs", cn: "运行" },
  { key: "tasks", label: "Tasks", cn: "任务" },
  { key: "context", label: "Context", cn: "上下文" },
  { key: "artifacts", label: "Artifacts", cn: "产物" },
  { key: "settings", label: "Settings", cn: "设置" }
];

export function FeatureRail({ active, onSelect, onOpenSettings }: FeatureRailProps) {
  return (
    <nav
      aria-label="Workbench navigation"
      className="flex h-full flex-col items-center gap-2 bg-[linear-gradient(180deg,var(--surface),var(--surface-tertiary))] px-1.5 py-3"
    >
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-[0_12px_26px_color-mix(in_oklab,var(--accent)_28%,transparent)]">
        <IconRobot />
      </div>

      <div className="flex w-full flex-1 flex-col items-center gap-1">
        {items.map((item) => {
          const isSettings = item.key === "settings";
          const isActive = item.key === active;
          return (
            <Tooltip key={item.key}>
              <Tooltip.Trigger className="w-full">
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
                    "relative flex w-full flex-col items-center gap-1 rounded-2xl px-1 py-2 transition-all",
                    isActive
                      ? "bg-accent-soft text-accent-soft-foreground"
                      : "text-muted hover:bg-default hover:text-foreground"
                  ].join(" ")}
                >
                  {ICONS[item.key]}
                  <span className="text-[11px] font-medium leading-none">{item.cn}</span>
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content>{item.cn}</Tooltip.Content>
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
