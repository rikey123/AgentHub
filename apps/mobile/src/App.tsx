import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentHubApiError, AgentHubClient, type AgentHubEventSubscription, type AgentHubJsonObject, type MobileArtifactPreviewResponse, type MobileConnectionConfig, parseMobileConnectionConfig } from "@agenthub/sdk";

import { clientBaseUrl, connectionCursorKey, forgetConnection, loadStoredConnection, normalizeManualConnection, storeConnection } from "./connection.ts";
import { applySnapshot, emptyMobileState, markOffline, mergeMessages, shouldRefreshSnapshot, stringField, visibleForRoom, type MobileState } from "./mobileState.ts";
import { resolveFetchImpl } from "./nativeHttp.ts";

type Notice = { readonly tone: "ok" | "warn" | "error"; readonly text: string };
type PreviewState = { readonly loading: boolean; readonly artifactId?: string; readonly path?: string; readonly data?: MobileArtifactPreviewResponse; readonly error?: string };

function makeIdempotencyKey(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `mobile:${prefix}:${Date.now()}:${random}`;
}

function storageCursor(key: string) {
  return {
    read: () => Number(window.localStorage.getItem(key) ?? "0"),
    write: (cursor: number) => { window.localStorage.setItem(key, String(cursor)); }
  };
}

type MobileTab = "chat" | "tasks" | "approvals" | "artifacts";

export function App(): React.JSX.Element {
  const [connection, setConnection] = useState<MobileConnectionConfig | null>(() => loadStoredConnection());
  const [state, setState] = useState<MobileState>(() => emptyMobileState);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reply, setReply] = useState("");
  const [tab, setTab] = useState<MobileTab>("chat");
  const [preview, setPreview] = useState<PreviewState>({ loading: false });
  const [files, setFiles] = useState<readonly AgentHubJsonObject[]>([]);
  const subscription = useRef<AgentHubEventSubscription | null>(null);
  const selectedRoomIdRef = useRef<string | null>(null);

  const client = useMemo(() => connection === null ? null : new AgentHubClient({ baseUrl: clientBaseUrl(connection), token: connection.token, fetchImpl: resolveFetchImpl() }), [connection]);
  const selectedRoomId = state.selectedRoomId;
  const roomMessages = state.messages;
  const roomTasks = visibleForRoom(state.tasks, selectedRoomId);
  const roomRuns = visibleForRoom(state.runs, selectedRoomId);
  const roomPermissions = visibleForRoom(state.permissions, selectedRoomId);
  const roomArtifacts = visibleForRoom(state.artifacts, selectedRoomId);

  useEffect(() => {
    selectedRoomIdRef.current = selectedRoomId;
  }, [selectedRoomId]);

  const refreshSnapshot = useCallback(async () => {
    if (client === null) return;
    try {
      const snapshot = await client.syncSnapshot();
      setState((current) => applySnapshot(current, snapshot));
    } catch (error) {
      setState((current) => markOffline(current, errorMessage(error)));
    }
  }, [client]);

  const refreshMessages = useCallback(async (targetRoomId: string | null) => {
    if (client === null || targetRoomId === null) return;
    try {
      const response = await client.listMessages(targetRoomId);
      setState((current) => ({ ...current, status: current.status === "offline" ? "connected" : current.status, messages: mergeMessages(current.messages, response.messages ?? []) }));
    } catch (error) {
      setState((current) => markOffline(current, errorMessage(error)));
    }
  }, [client]);

  useEffect(() => {
    if (connection === null || client === null) return;
    let cancelled = false;
    const cursorKey = connectionCursorKey(connection);
    setState((current) => ({ ...current, status: "loading", error: undefined }));
    void (async () => {
      try {
        const snapshot = await client.syncSnapshot();
        if (cancelled) return;
        setState((current) => applySnapshot(current, snapshot));
        const roomId = stringField(snapshot.rooms[0], "id") ?? null;
        if (roomId !== null) await refreshMessages(roomId);
        subscription.current?.close();
        subscription.current = client.eventStream({
          channel: "json-poll",
          view: "mobile",
          pollIntervalMs: 2_000,
          cursorStore: storageCursor(cursorKey),
          initialCursor: snapshot.cursor,
          reconnect: { initialDelayMs: 1_000, maxDelayMs: 15_000 }
        }).subscribe((event) => {
          if (!shouldRefreshSnapshot(event)) return;
          const currentRoomId = selectedRoomIdRef.current;
          void refreshSnapshot();
          void refreshMessages(currentRoomId);
        }, (error) => {
          setState((current) => markOffline(current, error.message));
        });
      } catch (error) {
        if (!cancelled) setState((current) => markOffline(current, errorMessage(error)));
      }
    })();
    return () => {
      cancelled = true;
      subscription.current?.close();
      subscription.current = null;
    };
  }, [client, connection, refreshMessages, refreshSnapshot]);

  useEffect(() => {
    void refreshMessages(selectedRoomId);
    setPreview({ loading: false });
    setFiles([]);
  }, [refreshMessages, selectedRoomId]);

  const connect = (config: MobileConnectionConfig): void => {
    storeConnection(config);
    setConnection(config);
    setNotice({ tone: "ok", text: "连接配置已保存" });
  };

  const disconnect = (): void => {
    subscription.current?.close();
    forgetConnection();
    setConnection(null);
    setState(emptyMobileState);
    setNotice(null);
    setFiles([]);
    setPreview({ loading: false });
  };

  const resolvePermission = async (requestId: string, decision: "allow" | "deny"): Promise<void> => {
    if (client === null) return;
    try {
      await client.resolvePermission(requestId, { decision, idempotencyKey: makeIdempotencyKey(`permission:${requestId}:${decision}`) });
      setNotice({ tone: "ok", text: decision === "allow" ? "已允许" : "已拒绝" });
      await refreshSnapshot();
    } catch (error) {
      if (error instanceof AgentHubApiError && (error.status === 409 || error.status === 404)) {
        setNotice({ tone: "warn", text: "该请求已被处理" });
        await refreshSnapshot();
        return;
      }
      setNotice({ tone: "error", text: errorMessage(error) });
    }
  };

  const sendReply = async (): Promise<void> => {
    if (client === null || selectedRoomId === null) return;
    const text = reply.trim();
    if (text.length === 0) return;
    try {
      await client.sendMessage(selectedRoomId, { text, idempotencyKey: makeIdempotencyKey(`message:${selectedRoomId}`) });
      setReply("");
      await refreshMessages(selectedRoomId);
      await refreshSnapshot();
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
    }
  };

  const selectArtifact = async (artifactId: string): Promise<void> => {
    if (client === null) return;
    setPreview({ loading: false, artifactId });
    setFiles([]);
    try {
      const response = await client.listArtifactFiles(artifactId);
      const nextFiles = response.files ?? [];
      setFiles(nextFiles);
      const firstPath = stringField(nextFiles[0], "path");
      if (firstPath !== undefined) await openPreview(artifactId, firstPath);
    } catch (error) {
      setPreview({ loading: false, artifactId, error: errorMessage(error) });
    }
  };

  const openPreview = async (artifactId: string, path: string): Promise<void> => {
    if (client === null) return;
    setPreview({ loading: true, artifactId, path });
    try {
      const data = await client.mobileArtifactPreview(artifactId, path);
      setPreview({ loading: false, artifactId, path, data });
    } catch (error) {
      setPreview({ loading: false, artifactId, path, error: errorMessage(error) });
    }
  };

  if (connection === null) return <ConnectScreen onConnect={connect} notice={notice} />;

  const pendingCount = roomPermissions.length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">AgentHub</p>
          <h1>{stringField(state.rooms.find((room) => stringField(room, "id") === selectedRoomId), "title") ?? `${connection.host}:${connection.port ?? "6677"}`}</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className={`status-pill ${state.status}`}>{statusLabel(state.status)}</span>
          <button className="icon-button" type="button" title="断开连接" aria-label="断开连接" onClick={disconnect}>⏻</button>
        </div>
      </header>

      <div className="app-body">
        {notice !== null && <p className={`notice notice-${notice.tone}`}>{notice.text}</p>}
        {state.error !== undefined && state.status !== "connected" && <p className="notice notice-error">{state.error}</p>}

        <section className="section">
          <div className="section-title">
            <h2>Rooms</h2>
            <button type="button" onClick={() => { void refreshSnapshot(); void refreshMessages(selectedRoomId); }}>↻ 同步</button>
          </div>
          {state.rooms.length === 0 ? <Empty label="暂无 Room" /> : (
            <div className="room-list">
              {state.rooms.map((room) => {
                const id = stringField(room, "id") ?? "";
                return (
                  <button key={id} className={id === selectedRoomId ? "room-item active" : "room-item"} type="button" onClick={() => setState((current) => ({ ...current, selectedRoomId: id, messages: [] }))}>
                    <span>{stringField(room, "title") ?? id}</span>
                    <small>{stringField(room, "mode") ?? "Room"}</small>
                  </button>
                );
              })}
            </div>
          )}
          <div className="meta-row">
            <span>{state.lastSyncedAt === null ? "尚未同步" : `${formatTime(state.lastSyncedAt)} 已同步`}</span>
            <span>· 游标 {state.cursor}</span>
          </div>
        </section>

        {tab === "chat" && (
          <section className="section">
            <div className="section-title">
              <h2>对话</h2>
              <span className="count">{roomMessages.length}</span>
            </div>
            <div className="message-list">
              {roomMessages.length === 0 ? <Empty label="暂无消息" /> : roomMessages.map((message) => {
                const role = stringField(message, "role", "author_type") ?? "message";
                return (
                  <article className={`message role-${role.toLowerCase()}`} key={stringField(message, "id") ?? JSON.stringify(message)}>
                    <strong>{role}</strong>
                    <p>{messageText(message)}</p>
                  </article>
                );
              })}
            </div>
            <div className="composer">
              <textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={1} placeholder={selectedRoomId === null ? "请先选择 Room" : "输入消息…"} />
              <button type="button" className="primary" onClick={() => { void sendReply(); }} disabled={selectedRoomId === null || reply.trim().length === 0}>发送</button>
            </div>
          </section>
        )}

        {tab === "tasks" && (
          <section className="section">
            <div className="section-title">
              <h2>任务</h2>
              <span className="count">{roomTasks.length}</span>
            </div>
            <StatusList items={roomTasks} primary="title" />
          </section>
        )}
        {tab === "tasks" && (
          <section className="section">
            <div className="section-title">
              <h2>Run</h2>
              <span className="count">{roomRuns.length}</span>
            </div>
            <StatusList items={roomRuns} primary="id" />
          </section>
        )}

        {tab === "approvals" && (
          <section className="section">
            <div className="section-title">
              <h2>权限审批</h2>
              <span className="count">{roomPermissions.length}</span>
            </div>
            {roomPermissions.length === 0 ? <Empty label="暂无待处理审批" /> : roomPermissions.map((permission) => {
              const id = stringField(permission, "id") ?? "";
              return (
                <article className="approval" key={id}>
                  <div>
                    <strong>{stringField(permission, "reason") ?? "权限请求"}</strong>
                    <p>{stringField(permission, "resource") ?? id}</p>
                  </div>
                  <div className="approval-actions">
                    <button type="button" className="danger" onClick={() => { void resolvePermission(id, "deny"); }}>拒绝</button>
                    <button type="button" className="primary" onClick={() => { void resolvePermission(id, "allow"); }}>允许</button>
                  </div>
                </article>
              );
            })}
          </section>
        )}

        {tab === "artifacts" && (
          <section className="section">
            <div className="section-title">
              <h2>产物</h2>
              <span className="count">只读</span>
            </div>
            {roomArtifacts.length === 0 ? <Empty label="暂无产物" /> : (
              <div className="artifact-list">
                {roomArtifacts.map((artifact) => {
                  const id = stringField(artifact, "id") ?? "";
                  return (
                    <button type="button" className={preview.artifactId === id ? "artifact active" : "artifact"} key={id} onClick={() => { void selectArtifact(id); }}>
                      <span>{stringField(artifact, "title") ?? id}</span>
                      <small>{stringField(artifact, "status") ?? stringField(artifact, "type") ?? "产物"}</small>
                    </button>
                  );
                })}
              </div>
            )}
            {files.length > 0 && (
              <div className="file-pills">
                {files.map((file) => {
                  const path = stringField(file, "path") ?? "";
                  return <button type="button" key={path} onClick={() => preview.artifactId !== undefined && void openPreview(preview.artifactId, path)}>{path}</button>;
                })}
              </div>
            )}
            {(preview.artifactId !== undefined || preview.loading) && <Preview preview={preview} />}
          </section>
        )}
      </div>

      <nav className="tabbar">
        <button type="button" className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}><span className="tab-icon">💬</span>对话</button>
        <button type="button" className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}><span className="tab-icon">◷</span>任务</button>
        <button type="button" className={tab === "approvals" ? "active" : ""} onClick={() => setTab("approvals")}><span className="tab-icon">✓</span>{pendingCount > 0 && <span className="tab-badge">{pendingCount}</span>}审批</button>
        <button type="button" className={tab === "artifacts" ? "active" : ""} onClick={() => setTab("artifacts")}><span className="tab-icon">▤</span>产物</button>
        <button type="button" onClick={() => { void refreshSnapshot(); void refreshMessages(selectedRoomId); }}><span className="tab-icon">↻</span>同步</button>
      </nav>
    </main>
  );
}

function ConnectScreen(props: { readonly onConnect: (config: MobileConnectionConfig) => void; readonly notice: Notice | null }): React.JSX.Element {
  const [payload, setPayload] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("6677");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const importPayload = (): void => {
    try {
      props.onConnect(parseMobileConnectionConfig(payload));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const importManual = (): void => {
    try {
      props.onConnect(normalizeManualConnection({ host, port, token }));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <main className="connect-shell">
      <section className="connect-panel">
        <div>
          <p className="eyebrow">AgentHub 移动端</p>
          <h1>连接到 daemon</h1>
        </div>
        <p className="lede">扫描或粘贴桌面端 / Web 端生成的连接配置，也可以手动填写。</p>
        {props.notice !== null && <p className={`notice notice-${props.notice.tone}`}>{props.notice.text}</p>}
        {error !== null && <p className="notice notice-error">{error}</p>}
        <label>
          身份码 / 二维码内容
          <textarea value={payload} onChange={(event) => setPayload(event.target.value)} rows={5} placeholder='粘贴桌面端「移动端验证」生成的身份码，或扫码内容' />
        </label>
        <button className="primary wide" type="button" onClick={importPayload} disabled={payload.trim().length === 0}>导入配置</button>
        <div className="divider">手动填写</div>
        <label>
          主机
          <input value={host} onChange={(event) => setHost(event.target.value)} placeholder="192.168.1.10" />
        </label>
        <label>
          端口
          <input value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" />
        </label>
        <label>
          令牌
          <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="ah_..." />
        </label>
        <button className="wide" type="button" onClick={importManual}>连接</button>
      </section>
    </main>
  );
}

function StatusList(props: { readonly items: readonly AgentHubJsonObject[]; readonly primary: string }): React.JSX.Element {
  if (props.items.length === 0) return <Empty label="暂无内容" />;
  return (
    <div className="item-list">
      {props.items.slice(0, 30).map((item) => {
        const status = stringField(item, "status") ?? "";
        return (
          <article className="list-item" key={stringField(item, "id") ?? JSON.stringify(item)}>
            <div style={{ minWidth: 0 }}>
              <div className="primary-text">{stringField(item, props.primary) ?? stringField(item, "id") ?? "—"}</div>
              {stringField(item, "assignee_agent_id", "agent_id") !== undefined && (
                <div className="sub-text">{stringField(item, "assignee_agent_id", "agent_id")}</div>
              )}
            </div>
            {status.length > 0 && <span className={`badge ${status.toLowerCase()}`}>{statusLabel(status)}</span>}
          </article>
        );
      })}
    </div>
  );
}

function Preview(props: { readonly preview: PreviewState }): React.JSX.Element {
  if (props.preview.loading) return <pre className="preview-box">正在加载预览…</pre>;
  if (props.preview.error !== undefined) return <pre className="preview-box error">{props.preview.error}</pre>;
  if (props.preview.data === undefined) return <pre className="preview-box muted">请选择一个产物文件</pre>;
  return <pre className="preview-box">{props.preview.data.content ?? ""}</pre>;
}

function Empty(props: { readonly label: string }): React.JSX.Element {
  return <p className="empty">{props.label}</p>;
}

// 与 web 端 lib/status.ts 的中文译法保持一致。
const STATUS_LABELS: Record<string, string> = {
  idle: "空闲",
  loading: "加载中",
  connected: "已连接",
  offline: "已断开连接",
  error: "连接失败",
  queued: "排队中",
  running: "运行中",
  in_progress: "进行中",
  starting: "启动中",
  waiting: "等待中",
  waiting_permission: "等待许可",
  pending: "待处理",
  blocked: "阻塞",
  review: "待评审",
  done: "已完成",
  completed: "已完成",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  cancelling: "取消中",
  allowed: "已允许",
  denied: "已拒绝",
  expired: "已过期",
  open: "待办"
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status.toLowerCase()] ?? status;
}

function messageText(message: AgentHubJsonObject): string {
  const direct = stringField(message, "text", "content");
  if (direct !== undefined) return direct;
  const parts = message.parts;
  if (Array.isArray(parts)) {
    return parts.map((part) => typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? part.text : "").filter(Boolean).join("\n");
  }
  return stringField(message, "id") ?? "";
}

function errorMessage(error: unknown): string {
  if (error instanceof AgentHubApiError) return `请求失败（${error.status}）`;
  return error instanceof Error ? error.message : String(error);
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
