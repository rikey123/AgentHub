#!/usr/bin/env node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDaemon } from "@agenthub/daemon";
import { AgentHubClient } from "@agenthub/sdk";

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const [command, subcommand] = argv;
  if (command === "status") {
    const url = valueArg(argv, "--url");
    const client = new AgentHubClient({ ...(url !== undefined ? { baseUrl: url } : {}) });
    process.stdout.write(`${JSON.stringify(await client.health())}\n`);
    return 0;
  }
  if (command === "mock" && subcommand === "solo") {
    const temp = mkdtempSync(join(tmpdir(), "agenthub-cli-"));
    const daemon = createDaemon({ databasePath: join(temp, "agenthub.sqlite"), port: 0 });
    const server = await daemon.start();
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("daemon did not bind TCP port");
    const client = new AgentHubClient({ baseUrl: `http://127.0.0.1:${address.port}` });
    const roomResult = await client.createRoom({ title: "CLI Mock Solo", mode: "solo", primaryAgentId: "mock-builder" }) as { readonly data?: { readonly roomId?: string } };
    const roomId = roomResult.data?.roomId;
    if (!roomId) throw new Error("room creation did not return roomId");
    await client.sendMessage(roomId, { text: valueArg(argv, "--message") ?? "hello mock", idempotencyKey: "cli-mock-solo" });
    const messages = await client.listMessages(roomId);
    process.stdout.write(`${JSON.stringify({ roomId, messages })}\n`);
    await daemon.close();
    return 0;
  }
  if (command === "permissions" && subcommand === "profiles") {
    const url = valueArg(argv, "--url");
    const client = new AgentHubClient({ ...(url !== undefined ? { baseUrl: url } : {}) });
    process.stdout.write(`${JSON.stringify(await client.listPermissionProfiles())}\n`);
    return 0;
  }
  if (command === "context" && subcommand === "list") {
    const url = valueArg(argv, "--url");
    const client = new AgentHubClient({ ...(url !== undefined ? { baseUrl: url } : {}) });
    const workspaceId = valueArg(argv, "--workspace");
    const status = valueArg(argv, "--status");
    process.stdout.write(`${JSON.stringify(await client.listContext({ ...(workspaceId !== undefined ? { workspaceId } : {}), ...(status !== undefined ? { status } : {}) }))}\n`);
    return 0;
  }
  if (command === "permissions" && subcommand === "requests") {
    const url = valueArg(argv, "--url");
    const client = new AgentHubClient({ ...(url !== undefined ? { baseUrl: url } : {}) });
    const status = valueArg(argv, "--status");
    const roomId = valueArg(argv, "--room");
    process.stdout.write(`${JSON.stringify(await client.listPermissionRequests({ ...(status !== undefined ? { status } : {}), ...(roomId !== undefined ? { roomId } : {}) }))}\n`);
    return 0;
  }
  if (command === "permissions" && subcommand === "resolve") {
    const url = valueArg(argv, "--url");
    const requestId = argv[2];
    const decision = valueArg(argv, "--decision");
    if (!requestId || (decision !== "allow" && decision !== "deny")) throw new Error("permissions resolve requires REQUEST_ID --decision allow|deny");
    const client = new AgentHubClient({ ...(url !== undefined ? { baseUrl: url } : {}) });
    const scope = valueArg(argv, "--scope");
    process.stdout.write(`${JSON.stringify(await client.resolvePermission(requestId, { decision, remember: argv.includes("--remember"), ...(scope !== undefined ? { scope } : {}) }))}\n`);
    return 0;
  }
  if (command === "interventions" && subcommand === "list") {
    const url = valueArg(argv, "--url");
    const client = new AgentHubClient({ ...(url !== undefined ? { baseUrl: url } : {}) });
    const roomId = valueArg(argv, "--room");
    const status = valueArg(argv, "--status");
    process.stdout.write(`${JSON.stringify(await client.listInterventions({ ...(roomId !== undefined ? { roomId } : {}), ...(status !== undefined ? { status } : {}) }))}\n`);
    return 0;
  }
  if (command === "artifacts" && subcommand === "list") {
    const url = valueArg(argv, "--url");
    const client = new AgentHubClient({ ...(url !== undefined ? { baseUrl: url } : {}) });
    const roomId = valueArg(argv, "--room");
    const status = valueArg(argv, "--status");
    process.stdout.write(`${JSON.stringify(await client.listArtifacts({ ...(roomId !== undefined ? { roomId } : {}), ...(status !== undefined ? { status } : {}) }))}\n`);
    return 0;
  }
  if (command === "debug" && subcommand === "stats") {
    const url = valueArg(argv, "--url");
    const client = new AgentHubClient({ ...(url !== undefined ? { baseUrl: url } : {}) });
    process.stdout.write(`${JSON.stringify(await client.debugStats())}\n`);
    return 0;
  }
  process.stderr.write("Usage: agenthub status [--url URL] | agenthub mock solo [--message TEXT] | agenthub context list [--workspace ID] [--status STATUS] | agenthub permissions profiles|requests|resolve ... | agenthub interventions list [--room ID] [--status STATUS] | agenthub artifacts list [--room ID] [--status STATUS] | agenthub debug stats\n");
  return 1;
}

function valueArg(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  runCli().then((code) => { process.exitCode = code; }, (error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
