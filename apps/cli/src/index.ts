#!/usr/bin/env node
import { runAgentsCommand } from "./commands/agents.ts";
import { runLegacyCommand } from "./commands/legacy.ts";

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const result = await runAgentsCommand(argv) ?? await runLegacyCommand(argv);
  if (result !== undefined) return result;
  process.stderr.write("Usage: agenthub agents reset --id=<agentId> | agenthub status [--url URL] | agenthub mock solo [--message TEXT] | agenthub context list [--workspace ID] [--status STATUS] | agenthub permissions profiles|requests|resolve ... | agenthub interventions list [--room ID] [--status STATUS] | agenthub artifacts list [--room ID] [--status STATUS] | agenthub debug stats\n");
  return 1;
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  runCli().then((code) => { process.exitCode = code; }, (error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
