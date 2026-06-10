import { roleDisplayName } from "./roles.ts";

const CAPABILITY_LABELS: Record<string, string> = {
  chat: "聊天",
  "code.edit": "代码编辑",
  "code.review": "代码评审",
  "file.read": "文件读取",
  "file.write": "文件写入",
  "terminal.run": "终端执行",
  "context.read": "上下文读取",
  "context.write": "上下文写入",
  "intervention.knock": "请求介入",
  "task.delegate": "任务分派",
  "artifact.publish": "产物发布",
  "web.search": "网页搜索"
};

const CONTACT_ROLE_LABELS: Record<string, string> = {
  archivist: "归档员",
  builder: "构建者",
  chatter: "聊天助手",
  generalist: "通用助手",
  "project-manager": "项目经理",
  reviewer: "评审员"
};

export function capabilityDisplayName(capability: string): string {
  return CAPABILITY_LABELS[capability] ?? capability;
}

export function contactRoleDisplayName(roleName: string | undefined, roleId: string | undefined): string {
  const value = roleName ?? roleId ?? "";
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/gu, "-").replace(/^role-/u, "");
  return CONTACT_ROLE_LABELS[normalized] ?? roleDisplayName(value) ?? value;
}
