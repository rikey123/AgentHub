import { resetBuiltInAgentTemplate } from "@agenthub/agents";

import { valueArg } from "../args.ts";
import { resolveAgentTemplatesDir } from "../package-resources.ts";

export async function runAgentsCommand(argv: readonly string[]): Promise<number | undefined> {
  const [, subcommand] = argv;
  if (subcommand !== "reset") return undefined;
  const agentId = valueArg(argv, "--id");
  if (agentId === undefined) throw new Error("agents reset requires --id=<agentId>");
  const templatesDir = resolveAgentTemplatesDir();
  const targetPath = resetBuiltInAgentTemplate(agentId, undefined, templatesDir);
  process.stdout.write(`${JSON.stringify({ agentId, path: targetPath })}\n`);
  return 0;
}
