export const DICEBEAR_AVATAR_ROUTE_VERSION = "v1";

export const DICEBEAR_AVATAR_STYLES = [
  "adventurer-neutral",
  "bottts-neutral",
  "lorelei-neutral",
  "notionists-neutral",
  "personas",
  "shapes"
] as const;

export type DiceBearAvatarStyle = typeof DICEBEAR_AVATAR_STYLES[number];

type AvatarPreset = {
  readonly style: DiceBearAvatarStyle;
  readonly seed: string;
};

const BUILTIN_ROLE_AVATARS: Readonly<Record<string, AvatarPreset>> = {
  "project-manager": { style: "notionists-neutral", seed: "role:project-manager" },
  builder: { style: "bottts-neutral", seed: "role:builder" },
  reviewer: { style: "notionists-neutral", seed: "role:reviewer" },
  archivist: { style: "lorelei-neutral", seed: "role:archivist" },
  generalist: { style: "adventurer-neutral", seed: "role:generalist" }
};

export function dicebearAvatarUrl(style: DiceBearAvatarStyle, seed: string): string {
  return `/avatars/dicebear/${DICEBEAR_AVATAR_ROUTE_VERSION}/${style}/${encodeURIComponent(seed)}.svg`;
}

export function defaultUserAvatarUrl(userId = "local"): string {
  void userId;
  return dicebearAvatarUrl("notionists-neutral", "Zoish");
}

export function defaultSystemAvatarUrl(systemId = "agenthub"): string {
  return dicebearAvatarUrl("shapes", `system:${systemId}`);
}

export function defaultAgentAvatarUrl(agentId: string): string {
  return dicebearAvatarUrl("bottts-neutral", `agent:${agentId}`);
}

export function defaultRoleAvatarUrl(roleId: string): string {
  const preset = BUILTIN_ROLE_AVATARS[roleId];
  if (preset !== undefined) return dicebearAvatarUrl(preset.style, preset.seed);
  return dicebearAvatarUrl("adventurer-neutral", `role:${roleId}`);
}

export function isAvatarImageUrl(value: unknown): value is string {
  return typeof value === "string" && (
    value.startsWith("/avatars/") ||
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:image/")
  );
}
