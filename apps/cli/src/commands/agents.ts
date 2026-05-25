import { resetBuiltInAgentTemplate } from "@agenthub/agents";

import { valueArg } from "../args.ts";

export async function runAgentsCommand(argv: readonly string[]): Promise<number | undefined> {
  const [, subcommand] = argv;
  if (subcommand !== "reset") return undefined;
  const agentId = valueArg(argv, "--id");
  if (agentId === undefined) throw new Error("agents reset requires --id=<agentId>");
  const targetPath = resetBuiltInAgentTemplate(agentId);
  process.stdout.write(`${JSON.stringify({ agentId, path: targetPath })}\n`);
  return 0;
}
