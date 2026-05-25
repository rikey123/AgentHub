export type MentionMember = {
  readonly agentId: string;
  readonly slug?: string;
};

const mentionPattern = /(^|\s)@([a-z0-9][a-z0-9-]*)\b/g;

export function parseMentions(text: string, members: readonly MentionMember[]): string[] {
  const bySlug = new Map<string, string>();
  for (const member of members) {
    bySlug.set(member.agentId, member.agentId);
    if (member.slug !== undefined && member.slug.length > 0) bySlug.set(member.slug, member.agentId);
  }

  const seen = new Set<string>();
  const mentions: string[] = [];
  for (const match of text.matchAll(mentionPattern)) {
    const slug = match[2];
    if (slug === undefined) continue;
    const agentId = bySlug.get(slug);
    if (agentId === undefined || seen.has(agentId)) continue;
    seen.add(agentId);
    mentions.push(agentId);
  }
  return mentions;
}
