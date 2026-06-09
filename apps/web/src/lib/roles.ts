type RoleLike = {
  readonly name: string;
  readonly description?: string | undefined;
};

export const BUILTIN_ROLE_DISPLAY_TEXT: Record<string, { title: string; description: string }> = {
  Archivist: {
    title: "归档员",
    description: "归档上下文，并产出已确认的摘要。"
  },
  Builder: {
    title: "构建者",
    description: "通用代码构建者。"
  },
  Generalist: {
    title: "通用助手",
    description: "没有特定专长方向的通用助手。"
  },
  "Project Manager": {
    title: "项目经理",
    description: "将工作拆分为任务，并把执行路由给合适的 agents。"
  },
  Reviewer: {
    title: "评审员",
    description: "审查代码，并可通过干预反馈发起提醒。"
  }
};

export function roleDisplayName(name: string | undefined): string {
  if (!name) return "";
  return BUILTIN_ROLE_DISPLAY_TEXT[name]?.title ?? name;
}

export function roleDisplayDescription(role: RoleLike): string | undefined {
  return BUILTIN_ROLE_DISPLAY_TEXT[role.name]?.description ?? role.description;
}

export function roleDisplayText(role: RoleLike): { title: string; description?: string | undefined } {
  const mapped = BUILTIN_ROLE_DISPLAY_TEXT[role.name];
  if (mapped) return mapped;
  return { title: role.name, description: role.description };
}
