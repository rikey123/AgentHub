import { valueArg } from "../args.ts";

export async function runAuthCommand(argv: readonly string[]): Promise<number | undefined> {
  const [command, subcommand] = argv;
  if (command !== "auth") return undefined;
  const baseUrl = valueArg(argv, "--url") ?? "http://127.0.0.1:6677";
  const token = valueArg(argv, "--token") ?? process.env.AGENTHUB_TOKEN;
  if (subcommand === "issue") {
    const description = valueArg(argv, "--description");
    if (description === undefined) throw new Error("auth issue requires --description=<s>");
    const scopes = (valueArg(argv, "--scope") ?? "read,write").split(",").map((scope) => scope.trim()).filter(Boolean);
    const expiresDays = numericArg(argv, "--expires-days");
    const payload = await request(baseUrl, "/auth/tokens", "POST", token, { description, scopes, ...(expiresDays !== undefined ? { expiresDays } : {}) }) as { readonly id: string; readonly token: string };
    process.stdout.write(`Token (save it now, won't be shown again): ${payload.token}\nId: ${payload.id}\n`);
    return 0;
  }
  if (subcommand === "list") {
    const payload = await request(baseUrl, "/auth/tokens", "GET", token) as { readonly tokens: readonly unknown[] };
    process.stdout.write(`${JSON.stringify(payload.tokens)}\n`);
    return 0;
  }
  if (subcommand === "revoke") {
    const id = argv[2];
    if (id === undefined) throw new Error("auth revoke requires <id>");
    await request(baseUrl, `/auth/tokens/${encodeURIComponent(id)}`, "DELETE", token);
    process.stdout.write(`revoked ${id}\n`);
    return 0;
  }
  throw new Error("Usage: agenthub auth issue|list|revoke");
}

async function request(baseUrl: string, path: string, method: string, token?: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error(JSON.stringify(payload));
  return payload;
}

function numericArg(argv: readonly string[], name: string): number | undefined {
  const value = valueArg(argv, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
