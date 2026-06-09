export type SkillDisplayLike = {
  readonly name: string;
  readonly description?: string | undefined;
  readonly origin?: string | undefined;
};

const BUILTIN_SKILL_DESCRIPTION_TEXT: Record<string, string> = {
  "skill-creator": "帮助用户按标准 SKILL.md 格式创建新的 skills。",
  "task-planner": "帮助 agents 将复杂工作拆解为边界清晰、依赖明确、可分配的任务。"
};

export function skillDisplayName(skillOrName: SkillDisplayLike | string): string {
  return typeof skillOrName === "string" ? skillOrName : skillOrName.name;
}

export function skillDisplayDescription(skill: SkillDisplayLike): string {
  return BUILTIN_SKILL_DESCRIPTION_TEXT[skill.name] ?? skill.description ?? "";
}

export function skillOriginLabel(origin?: string | undefined): string {
  if (origin === "builtin") return "内置";
  if (origin === "workspace") return "工作区";
  if (origin === "imported") return "已导入";
  return origin ?? "";
}

export function skillOriginColor(origin?: string | undefined): "default" | "accent" | "success" | "warning" | "danger" {
  if (origin === "builtin") return "accent";
  if (origin === "workspace") return "success";
  if (origin === "imported") return "warning";
  return "default";
}
