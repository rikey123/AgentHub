export type MentionMember = {
  readonly agentId: string;
  readonly slug?: string;
  readonly name?: string;
};

// Matches @slug where slug is lowercase-kebab (e.g. @opencode-builder).
// Also matches @"Display Name" and @'Display Name' for names with spaces.
const mentionPattern = /(^|\s)@(?:"([^"]+)"|'([^']+)'|([a-z0-9][a-z0-9-]*))/g;

/** Convert a display name to a kebab-case slug: "OpenCode Builder" → "opencode-builder" */
export function nameToSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseMentions(text: string, members: readonly MentionMember[]): string[] {
  const bySlug = new Map<string, string>();
  for (const member of members) {
    bySlug.set(member.agentId, member.agentId);
    if (member.slug !== undefined && member.slug.length > 0) bySlug.set(member.slug, member.agentId);
    // Also index by name-derived slug so "@OpenCode Builder" resolves correctly
    if (member.name !== undefined && member.name.length > 0) {
      bySlug.set(nameToSlug(member.name), member.agentId);
    }
  }

  const seen = new Set<string>();
  const mentions: string[] = [];
  for (const match of text.matchAll(mentionPattern)) {
    // Groups: [2]=double-quoted name, [3]=single-quoted name, [4]=bare kebab slug
    const raw = match[2] ?? match[3] ?? match[4];
    if (raw === undefined) continue;
    // Normalise: quoted names go through nameToSlug, bare slugs are already lowercase
    const slug = match[4] !== undefined ? raw : nameToSlug(raw);
    const agentId = bySlug.get(slug);
    if (agentId === undefined || seen.has(agentId)) continue;
    seen.add(agentId);
    mentions.push(agentId);
  }
  return mentions;
}
