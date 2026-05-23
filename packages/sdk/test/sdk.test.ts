import { describe, expect, it } from "vitest";

import { AgentHubClient } from "../src/index.ts";

describe("AgentHubClient", () => {
  it("calls JSON daemon APIs", async () => {
    const calls: string[] = [];
    const client = new AgentHubClient({
      baseUrl: "http://daemon",
      fetchImpl: (async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch
    });
    await expect(client.health()).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["http://daemon/healthz"]);
  });

  it("builds permission API requests", async () => {
    const calls: string[] = [];
    const client = new AgentHubClient({
      baseUrl: "http://daemon",
      fetchImpl: (async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch
    });
    await client.listPermissionRequests({ status: "pending", roomId: "room_1" });
    await client.resolvePermission("preq_1", { decision: "allow", remember: true });
    expect(calls).toEqual(["http://daemon/permissions/requests?status=pending&roomId=room_1", "http://daemon/permissions/preq_1/resolve"]);
  });

  it("does not publish an SDK helper for internal-only context injection", () => {
    const client = new AgentHubClient({ baseUrl: "http://daemon" });

    expect("injectContext" in client).toBe(false);
  });

  it("builds intervention and debug API requests", async () => {
    const calls: string[] = [];
    const client = new AgentHubClient({
      baseUrl: "http://daemon",
      fetchImpl: (async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch
    });

    await client.listInterventions({ roomId: "room_1", status: "pending_user_decision" });
    await client.approveIntervention("int_1", { effectiveText: "edited" });
    await client.debugEvents({ traceId: "trace_1", limit: "10" });
    await client.debugStats();

    expect(calls).toEqual(["http://daemon/interventions?roomId=room_1&status=pending_user_decision", "http://daemon/interventions/int_1/approve", "http://daemon/debug/events?traceId=trace_1&limit=10", "http://daemon/debug/stats"]);
  });
});
