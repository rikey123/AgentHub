import { lineNumberFor, readText, runCheck, unique, walkFiles } from "./lib.mjs";

const internalOnlyCommands = new Set(["WakeAgent", "RetryRun", "InjectContext", "ConsumePendingTurn"]);
const forbiddenCommands = ["StartRun", "ApplyMailboxClaimRollback"];
const expectedWakeFields = [
  "roomId",
  "agentId",
  "workspaceId",
  "reason",
  "triggerEventId",
  "promptDelta",
  "targetFiles",
  "workspaceMode",
  "parentRunId",
  "messageId",
  "pendingTurnId",
  "carryNextTurnIds",
  "sourceRunId",
  "idempotencyKey"
];
const expectedCreateRunFields = ["runId", "agentId", "roomId", "taskId", "workspaceId", "wakeReason", "workspaceMode", "parentRunId", "targetFiles", "promptDelta", "mailboxClaimIds", "carryNextTurnIds", "sourceRunId", "triggerEventId", "messageId", "pendingTurnId"];

function extractCommandTypes(spec) {
  const commandBlock = spec.slice(spec.indexOf("type Command ="), spec.indexOf("type CommandResult"));
  return unique([...commandBlock.matchAll(/type:\s*"([A-Z][A-Za-z0-9]+)"/g)].map((match) => match[1]));
}

await runCheck("command:check", async function checkCommands() {
  const errors = [];
  const busSpec = await readText("openspec/specs/bus-runtime/spec.md");
  const orchestratorSpec = await readText("openspec/specs/orchestrator/spec.md");
  const commandTypes = new Set(extractCommandTypes(busSpec));

  for (const command of forbiddenCommands) {
    if (commandTypes.has(command)) errors.push(`forbidden Command '${command}' must not be present in canonical Command union`);
  }
  for (const command of internalOnlyCommands) {
    if (!commandTypes.has(command)) errors.push(`internal-only Command '${command}' is missing from canonical Command union`);
  }

  const wakeCommandFieldsLine = busSpec.match(/WakeAgent";([^\n]+)/)?.[1] ?? "";
  for (const field of expectedWakeFields) {
    if (!wakeCommandFieldsLine.includes(`${field}:`) && !wakeCommandFieldsLine.includes(`${field}?`)) errors.push(`WakeAgent Command union missing field '${field}'`);
  }
  for (const field of expectedWakeFields) {
    if (!orchestratorSpec.includes(`${field}:`) && !orchestratorSpec.includes(`${field}?`)) errors.push(`orchestrator WakeAgentInput missing aligned field '${field}'`);
  }
  for (const field of expectedCreateRunFields) {
    if (!busSpec.includes(`${field}:`) && !busSpec.includes(`${field}?`)) errors.push(`bus-runtime CreateRunInput missing field '${field}'`);
  }

  const sourceFiles = [
    ...(await walkFiles("packages", { extensions: [".ts"] })),
    ...(await walkFiles("apps", { extensions: [".ts", ".tsx"] }))
  ];
  const dispatchPattern = /dispatch\s*\(\s*\{[\s\S]{0,800}?type:\s*["`]([A-Z][A-Za-z0-9]+)["`][\s\S]{0,800}?\}/g;
  const mutatingRoutePattern = /\b(?:app|router|routes)\s*\.\s*(?:post|put|patch|delete)\s*\(/g;
  const directPublishPattern = /\b(?:eventBus|bus)\s*\.\s*publish\s*\(/;
  const domainWritePattern = /\b(?:db|database|sqlite|tx)\s*\.\s*(?:insert|update|delete|exec|prepare)\s*\(/;

  for (const file of sourceFiles) {
    const source = await readText(file);
    if (!file.endsWith(".test.ts") && !file.endsWith(".test.tsx")) {
      for (const command of forbiddenCommands) {
        const forbiddenPattern = new RegExp(`["']${command}["']`, "g");
        for (const match of source.matchAll(forbiddenPattern)) {
          errors.push(`forbidden Command '${command}' referenced from ${file}:${lineNumberFor(source, match.index)}`);
        }
      }
    }
    if (!file.endsWith(".test.ts") && !file.endsWith(".test.tsx")) {
      for (const match of source.matchAll(dispatchPattern)) {
        const command = match[1];
        const call = match[0];
        if (!commandTypes.has(command)) errors.push(`dispatch references unknown Command '${command}' in ${file}:${lineNumberFor(source, match.index)}`);
        if (internalOnlyCommands.has(command) && /origin:\s*["`]http["`]/.test(call)) errors.push(`internal-only Command '${command}' dispatched with origin='http' in ${file}:${lineNumberFor(source, match.index)}`);
        if (command === "WakeAgent" && call.includes("carryNextTurnIds") && !call.includes("sourceRunId")) errors.push(`WakeAgent dispatch with carryNextTurnIds must include sourceRunId in ${file}:${lineNumberFor(source, match.index)}`);
      }
    }
    if (file.startsWith("apps/daemon/") || file.startsWith("packages/daemon/")) {
      for (const match of source.matchAll(mutatingRoutePattern)) {
        const routeBlock = source.slice(match.index, match.index + 2000);
        const line = lineNumberFor(source, match.index);
        if (!/commandBus\s*\.\s*dispatch\s*\(/.test(routeBlock)) {
          errors.push(`mutating HTTP route must dispatch through CommandBus in ${file}:${line}`);
        }
        if (directPublishPattern.test(routeBlock)) {
          errors.push(`mutating HTTP route directly publishes events in ${file}:${line}`);
        }
        if (domainWritePattern.test(routeBlock)) {
          errors.push(`mutating HTTP route directly writes domain state in ${file}:${line}`);
        }
      }
    }
  }

  checkCommands.detail = `${commandTypes.size} canonical commands + mutating HTTP guard`;
  return errors;
});
