import { describe, expect, it } from "vitest";

import { AgentHubClient, AgentHubEventStream, parseMobileConnectionConfig, type EventSourceLike } from "../src/index.ts";

type Listener = (event: MessageEvent<string>) => void;

class FakeEventSource implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  readonly listeners = new Map<string, Listener[]>();
  closed = false;

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: unknown): void {
    const event = { data: JSON.stringify(data) } as MessageEvent<string>;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function envelope(seq: number, type = "room.created") {
  return {
    id: `evt_${seq}`,
    type,
    schemaVersion: 1,
    durability: "durable",
    visibility: "main",
    seq,
    workspaceId: "workspace_1",
    payload: { seq },
    createdAt: 1_700_000_000_000 + seq
  };
}

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

  it("sends V1.0 team room creation fields without dropping role bindings", async () => {
    const calls: Array<{ readonly url: string; readonly body: unknown }> = [];
    const client = new AgentHubClient({
      baseUrl: "http://daemon",
      fetchImpl: (async (url, init) => {
        calls.push({
          url: String(url),
          body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) as unknown
        });
        return new Response(JSON.stringify({ data: { roomId: "room_team" } }), { status: 201 });
      }) as typeof fetch
    });

    await client.createRoom({
      title: "Team room",
      mode: "team",
      primaryAgentId: "binding_leader",
      leaderRoleId: "role_leader",
      participants: [
        { roleId: "role_leader", runtimeId: "native-default", modelConfigId: "mc_1", defaultPresence: "active" },
        { roleId: "role_reviewer", runtimeId: "claude-code-default", defaultPresence: "active" }
      ]
    });

    expect(calls).toEqual([{
      url: "http://daemon/rooms",
      body: {
        title: "Team room",
        mode: "team",
        primaryAgentId: "binding_leader",
        leaderRoleId: "role_leader",
        participants: [
          { roleId: "role_leader", runtimeId: "native-default", modelConfigId: "mc_1", defaultPresence: "active" },
          { roleId: "role_reviewer", runtimeId: "claude-code-default", defaultPresence: "active" }
        ]
      }
    }]);
  });

  it("sends per-participant skill assignments when creating a room", async () => {
    const calls: Array<{ readonly url: string; readonly body: unknown }> = [];
    const client = new AgentHubClient({
      baseUrl: "http://daemon",
      fetchImpl: (async (url, init) => {
        calls.push({
          url: String(url),
          body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) as unknown
        });
        return new Response(JSON.stringify({ data: { roomId: "room_skilled_contact" } }), { status: 201 });
      }) as typeof fetch
    });

    await client.createRoom({
      title: "Skilled contact room",
      mode: "assisted",
      primaryAgentId: "binding_builder",
      participantSkillAssignments: [
        {
          participantId: "binding_reviewer",
          skillIds: ["skill_review"],
          mode: "add"
        }
      ],
      participants: [{
        type: "agent",
        agentId: "binding_reviewer",
        agentBindingId: "binding_reviewer",
        role: "teammate",
        defaultPresence: "active"
      }]
    });

    expect(calls).toEqual([{
      url: "http://daemon/rooms",
      body: {
        title: "Skilled contact room",
        mode: "assisted",
        primaryAgentId: "binding_builder",
        participantSkillAssignments: [
          {
            participantId: "binding_reviewer",
            skillIds: ["skill_review"],
            mode: "add"
          }
        ],
        participants: [{
          type: "agent",
          agentId: "binding_reviewer",
          agentBindingId: "binding_reviewer",
          role: "teammate",
          defaultPresence: "active"
        }]
      }
    }]);
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

  it("builds the assisted discussion stop request", async () => {
    const calls: Array<{ readonly url: string; readonly method?: string }> = [];
    const client = new AgentHubClient({
      baseUrl: "http://daemon",
      fetchImpl: (async (url, init) => {
        calls.push({ url: String(url), ...(init?.method !== undefined ? { method: init.method } : {}) });
        return new Response(JSON.stringify({ ok: true, cancelledRunIds: ["run-1"] }), { status: 200 });
      }) as typeof fetch
    });

    await client.stopDiscussion("room_1");

    expect(calls).toEqual([{ url: "http://daemon/rooms/room_1/discussion/stop", method: "POST" }]);
  });

  it("sends structured context refs with chat messages", async () => {
    const calls: Array<{ readonly url: string; readonly body: unknown }> = [];
    const client = new AgentHubClient({
      baseUrl: "http://daemon",
      fetchImpl: (async (url, init) => {
        calls.push({
          url: String(url),
          body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) as unknown
        });
        return new Response(JSON.stringify({ data: { messageId: "message_1" } }), { status: 200 });
      }) as typeof fetch
    });

    await client.sendMessage("room_1", {
      text: "Fix @artifact:artifact_1#L2-L3",
      refs: [{ type: "artifact", artifactId: "artifact_1", lineStart: 2, lineEnd: 3 }]
    });

    expect(calls).toEqual([{
      url: "http://daemon/rooms/room_1/messages",
      body: {
        text: "Fix @artifact:artifact_1#L2-L3",
        refs: [{ type: "artifact", artifactId: "artifact_1", lineStart: 2, lineEnd: 3 }]
      }
    }]);
  });

  it("parses mobile connection configs from qrPayload JSON", () => {
    const config = parseMobileConnectionConfig(JSON.stringify({
      version: 1,
      url: "http://192.168.1.10:6677",
      host: "192.168.1.10",
      port: 6677,
      token: "ah_token",
      tokenId: "token_1",
      scopes: ["read"],
      expiresAt: null
    }));

    expect(config).toEqual({
      version: 1,
      url: "http://192.168.1.10:6677",
      host: "192.168.1.10",
      port: 6677,
      token: "ah_token",
      tokenId: "token_1",
      scopes: ["read"],
      expiresAt: null
    });
  });

  it("parses mobile connection configs from structured LAN manifests", () => {
    const config = parseMobileConnectionConfig(JSON.stringify({
      version: 2,
      kind: "agenthub.mobile.connection",
      endpoint: {
        protocol: "http",
        url: "http://192.168.1.10:6677",
        host: "192.168.1.10",
        port: 6677,
        network: "lan",
        source: "mobile-bridge",
        reachableFromMobile: true
      },
      auth: {
        scheme: "bearer",
        token: "ah_token",
        tokenId: "token_1",
        scopes: ["read", "write"],
        expiresAt: null
      }
    }));

    expect(config).toEqual({
      version: 2,
      url: "http://192.168.1.10:6677",
      host: "192.168.1.10",
      port: 6677,
      token: "ah_token",
      tokenId: "token_1",
      scopes: ["read", "write"],
      expiresAt: null,
      endpoint: {
        protocol: "http",
        url: "http://192.168.1.10:6677",
        host: "192.168.1.10",
        port: 6677,
        network: "lan",
        source: "mobile-bridge",
        reachableFromMobile: true
      }
    });
  });

  it("parses mobile connection configs from scanned URLs", () => {
    const config = parseMobileConnectionConfig("http://192.168.1.10:6677/qr-login?token=ah_token");

    expect(config).toMatchObject({
      version: 1,
      url: "http://192.168.1.10:6677",
      host: "192.168.1.10",
      port: 6677,
      token: "ah_token"
    });
  });

  it("builds mobile snapshot and read-only preview requests", async () => {
    const calls: Array<{ readonly url: string; readonly headers: HeadersInit | undefined }> = [];
    const client = new AgentHubClient({
      baseUrl: "http://daemon",
      token: "ah_token",
      fetchImpl: (async (url, init) => {
        calls.push({ url: String(url), headers: init?.headers });
        return new Response(JSON.stringify(String(url).includes("/sync/snapshot")
          ? { view: "mobile", cursor: 9, rooms: [], tasks: [], runs: [], permissions: [], artifacts: [] }
          : { artifact: { id: "artifact_1" }, file: { path: "src/index.ts" }, content: "preview" }), { status: 200 });
      }) as typeof fetch
    });

    await client.syncSnapshot({ roomId: "room_1" });
    await client.mobileArtifactPreview("artifact_1", "src/index.ts");

    expect(calls).toEqual([
      { url: "http://daemon/sync/snapshot?view=mobile&roomId=room_1", headers: { accept: "application/json", authorization: "Bearer ah_token" } },
      { url: "http://daemon/mobile/artifacts/artifact_1/files/src%2Findex.ts", headers: { accept: "application/json", authorization: "Bearer ah_token" } }
    ]);
  });

  it("subscribes to SSE with an injected cursor store and deduplicates replayed events", async () => {
    const writes: number[] = [];
    const sources: FakeEventSource[] = [];
    const delivered: number[] = [];
    const stream = new AgentHubEventStream({
      baseUrl: "http://daemon/",
      view: "main",
      cursorStore: {
        read: () => 4,
        write: (cursor) => { writes.push(cursor); }
      },
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source;
      }
    });

    const subscription = stream.subscribe((event) => { if (event.seq !== undefined) delivered.push(event.seq); });
    await waitFor(() => sources.length > 0);

    expect(sources[0]?.url).toBe("http://daemon/event?view=main&cursor=4");
    sources[0]?.emit("room.created", envelope(4));
    sources[0]?.emit("room.created", envelope(5));
    sources[0]?.emit("room.created", envelope(6));
    await waitFor(() => delivered.length === 2);

    expect(delivered).toEqual([5, 6]);
    expect(writes).toEqual([5, 6]);
    expect(subscription.cursor).toBe(6);
    subscription.close();
  });

  it("reconnects SSE from the latest cursor after errors", async () => {
    const sources: FakeEventSource[] = [];
    const stream = new AgentHubEventStream({
      baseUrl: "http://daemon",
      reconnect: { initialDelayMs: 1, maxDelayMs: 1 },
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source;
      }
    });

    const subscription = stream.subscribe(() => undefined);
    await waitFor(() => sources.length > 0);
    sources[0]?.emit("room.created", envelope(7));
    sources[0]?.onerror?.(new Event("error"));
    await waitFor(() => sources.length > 1);

    expect(sources[1]?.url).toBe("http://daemon/event?view=main&cursor=7");
    subscription.close();
  });

  it("can poll JSON sync events and continue from the stored cursor", async () => {
    const calls: string[] = [];
    const writes: number[] = [];
    const delivered: number[] = [];
    const stream = new AgentHubEventStream({
      baseUrl: "http://daemon",
      channel: "json-poll",
      view: "mobile",
      token: "token_1",
      pollIntervalMs: 1_000,
      cursorStore: {
        read: () => 10,
        write: (cursor) => { writes.push(cursor); }
      },
      fetchImpl: (async (url, init) => {
        calls.push(`${String(url)} ${JSON.stringify(init?.headers ?? {})}`);
        return new Response(JSON.stringify({ events: [envelope(10), envelope(11), envelope(12)], nextCursor: 12 }), { status: 200 });
      }) as typeof fetch
    });

    const subscription = stream.subscribe((event) => { if (event.seq !== undefined) delivered.push(event.seq); });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(calls).toEqual(['http://daemon/sync/events?view=mobile&sinceSeq=10 {"accept":"application/json","authorization":"Bearer token_1"}']);
    expect(delivered).toEqual([11, 12]);
    expect(writes).toEqual([11, 12]);
    subscription.close();
  });

  it("does not let an older stored cursor override the initial cursor", async () => {
    const calls: string[] = [];
    const delivered: number[] = [];
    const stream = new AgentHubEventStream({
      baseUrl: "http://daemon",
      channel: "json-poll",
      view: "mobile",
      initialCursor: 50,
      pollIntervalMs: 1_000,
      cursorStore: {
        read: () => 10,
        write: () => undefined
      },
      fetchImpl: (async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ events: [envelope(50), envelope(51)], nextCursor: 51 }), { status: 200 });
      }) as typeof fetch
    });

    const subscription = stream.subscribe((event) => { if (event.seq !== undefined) delivered.push(event.seq); });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(calls).toEqual(["http://daemon/sync/events?view=mobile&sinceSeq=50"]);
    expect(delivered).toEqual([51]);
    subscription.close();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 100;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
