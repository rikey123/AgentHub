import type { AgentHubDatabase } from "@agenthub/db";

const ROLE_DRAFT_GC_INTERVAL_MS = 60 * 60 * 1000;

export function cleanExpiredRoleDrafts(database: AgentHubDatabase, now: number): number {
  const result = database.sqlite.prepare("DELETE FROM role_drafts WHERE expires_at < ?").run(now);
  return result.changes;
}

export function startRoleDraftGC(database: AgentHubDatabase, onClose: () => void): () => void {
  const interval = setInterval(() => {
    cleanExpiredRoleDrafts(database, Date.now());
  }, ROLE_DRAFT_GC_INTERVAL_MS);
  interval.unref?.();
  return () => {
    clearInterval(interval);
    onClose();
  };
}
