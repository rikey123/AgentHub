import type { AgentHubDatabase } from "@agenthub/db";

type CheckpointRow = {
  readonly progress_summary: string;
  readonly files_touched: string;
};

/**
 * Builds a <prior-progress> XML block from the most recent task checkpoint.
 * Returns undefined if no checkpoint exists for the task.
 * Per spec: injected after <mission-brief> and before the role system prompt.
 */
export function buildPriorProgressBlock(database: AgentHubDatabase, taskId: string): string | undefined {
  const row = database.sqlite
    .prepare(
      "SELECT progress_summary, files_touched FROM task_checkpoints WHERE task_id = ? ORDER BY created_at DESC LIMIT 1"
    )
    .get(taskId) as CheckpointRow | undefined;
  if (!row) return undefined;

  const summary = xmlEscape(row.progress_summary.slice(0, 2000));
  let filesTouchedLines = "";
  try {
    const paths = JSON.parse(row.files_touched) as string[];
    if (paths.length > 0) {
      filesTouchedLines = paths.map((p) => `  <file>${xmlEscape(p)}</file>`).join("\n");
    }
  } catch {
    filesTouchedLines = "";
  }

  const lines = [
    "<prior-progress>",
    `  <summary>${summary}</summary>`,
  ];
  if (filesTouchedLines) {
    lines.push("  <files-touched>", filesTouchedLines, "  </files-touched>");
  }
  lines.push("</prior-progress>");
  return lines.join("\n");
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
