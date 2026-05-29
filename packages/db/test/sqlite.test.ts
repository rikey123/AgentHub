import Database from "better-sqlite3";
import { getTableColumns, getTableName, sql } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { applyMigrations, applySqlitePragmas, createDatabase, schema } from "../src/index.ts";

type Sqlite = Database.Database;
type DrizzleTable = Parameters<typeof getTableName>[0];
type TableContract = {
  readonly exportName: keyof typeof schema;
  readonly table: DrizzleTable;
};

let db: Sqlite | undefined;

const drizzleTables = [
  { exportName: "workspaces", table: schema.workspaces },
  { exportName: "rooms", table: schema.rooms },
  { exportName: "roomParticipants", table: schema.roomParticipants },
  { exportName: "agentProfiles", table: schema.agentProfiles },
  { exportName: "roles", table: schema.roles },
  { exportName: "runtimes", table: schema.runtimes },
  { exportName: "modelConfigs", table: schema.modelConfigs },
  { exportName: "agentBindings", table: schema.agentBindings },
  { exportName: "agentPresence", table: schema.agentPresence },
  { exportName: "messages", table: schema.messages },
  { exportName: "messageParts", table: schema.messageParts },
  { exportName: "attachments", table: schema.attachments },
  { exportName: "events", table: schema.events },
  { exportName: "tasks", table: schema.tasks },
  { exportName: "roleDrafts", table: schema.roleDrafts },
  { exportName: "taskActivities", table: schema.taskActivities },
  { exportName: "runs", table: schema.runs },
  { exportName: "taskRuns", table: schema.taskRuns },
  { exportName: "contextItems", table: schema.contextItems },
  { exportName: "contextVersions", table: schema.contextVersions },
  { exportName: "permissionProfiles", table: schema.permissionProfiles },
  { exportName: "permissionRules", table: schema.permissionRules },
  { exportName: "permissionRequests", table: schema.permissionRequests },
  { exportName: "interventions", table: schema.interventions },
  { exportName: "artifacts", table: schema.artifacts },
  { exportName: "artifactFiles", table: schema.artifactFiles },
  { exportName: "mailboxMessages", table: schema.mailboxMessages },
  { exportName: "pendingTurns", table: schema.pendingTurns },
  { exportName: "runNextTurns", table: schema.runNextTurns },
  { exportName: "mailboxDeliveries", table: schema.mailboxDeliveries },
  { exportName: "authTokens", table: schema.authTokens },
  { exportName: "sessions", table: schema.sessions },
  { exportName: "outbox", table: schema.outbox },
  { exportName: "handlerCursors", table: schema.handlerCursors },
  { exportName: "deadLetterEvents", table: schema.deadLetterEvents },
  { exportName: "runLocks", table: schema.runLocks },
  { exportName: "commandRecords", table: schema.commandRecords }
] satisfies readonly TableContract[];

const drizzleSmokeRows = {
  workspaces: { id: "ws_drizzle", name: "Workspace", rootPath: "/tmp/ws", createdAt: 1, updatedAt: 1 },
  rooms: {
    id: "room_drizzle",
    workspaceId: "ws_drizzle",
    title: "Room",
    mode: "solo",
    defaultContextScope: "room",
    createdAt: 1,
    updatedAt: 1
  },
  roomParticipants: {
    roomId: "room_drizzle",
    participantId: "agent_drizzle",
    participantType: "agent",
    role: "primary",
    defaultPresence: "observing",
    joinedAt: 1
  },
  agentProfiles: {
    id: "agent_drizzle",
    name: "Builder",
    adapterId: "mock",
    rolePrompt: "Build",
    capabilities: "{}",
    hidden: 0,
    createdAt: 1,
    updatedAt: 1
  },
  roles: {
    id: "role_drizzle",
    name: "Builder",
    avatar: "🧱",
    prompt: "Build",
    capabilities: "[]",
    defaultPermissionProfileId: "pp_drizzle",
    tags: "[]",
    isBuiltin: 0,
    createdAt: 1,
    updatedAt: 1
  },
  runtimes: {
    id: "runtime_drizzle",
    kind: "native",
    name: "Native",
    supportedCaps: "[]",
    manifestJson: "{}",
    createdAt: 1,
    updatedAt: 1
  },
  modelConfigs: {
    id: "model_config_drizzle",
    name: "Default",
    provider: "openai",
    model: "gpt-4.1",
    temperature: 0.2,
    maxTokens: 1024,
    reasoning: "{}",
    extra: "{}",
    createdAt: 1,
    updatedAt: 1
  },
  agentBindings: {
    id: "binding_drizzle",
    roleId: "role_drizzle",
    runtimeId: "runtime_drizzle",
    overridePermissionProfileId: "pp_drizzle",
    createdAt: 1,
    updatedAt: 1
  },
  agentPresence: { roomId: "room_drizzle", agentId: "agent_drizzle", state: "observing", updatedAt: 1 },
  messages: {
    id: "msg_drizzle",
    workspaceId: "ws_drizzle",
    roomId: "room_drizzle",
    senderType: "user",
    role: "user",
    status: "created",
    turnDispatchMode: "immediate",
    createdAt: 1,
    updatedAt: 1
  },
  messageParts: { messageId: "msg_drizzle", seq: 1, partType: "text", payload: '{"text":"hi"}', createdAt: 1 },
  attachments: {
    id: "att_drizzle",
    messageId: "msg_drizzle",
    fileId: "file_drizzle",
    fileName: "a.txt",
    byteSize: 1,
    storagePath: "/tmp/a.txt",
    createdAt: 1
  },
  events: {
    id: "evt_drizzle",
    seq: 1,
    type: "message.created",
    schemaVersion: 1,
    visibility: "both",
    payload: "{}",
    createdAt: 1
  },
  tasks: {
    id: "task_drizzle",
    workspaceId: "ws_drizzle",
    title: "Task",
    status: "open",
    dependencies: "[]",
    createdAt: 1,
    updatedAt: 1
  },
  roleDrafts: {
    jobId: "job_drizzle",
    description: "Generate a role",
    modelConfigId: "model_config_drizzle",
    status: "pending",
    createdAt: 1,
    updatedAt: 1,
    expiresAt: 2
  },
  taskActivities: {
    id: "activity_drizzle",
    taskId: "task_drizzle",
    kind: "comment",
    byKind: "user",
    by: "user_drizzle",
    payload: "{}",
    createdAt: 1
  },
  runs: {
    id: "run_drizzle",
    workspaceId: "ws_drizzle",
    roomId: "room_drizzle",
    agentId: "agent_drizzle",
    status: "queued",
    targetFiles: "[]",
    mailboxClaimCount: 0,
    createdAt: 1,
    updatedAt: 1
  },
  taskRuns: { id: "tr_drizzle", taskId: "task_drizzle", runId: "run_drizzle", createdAt: 1 },
  contextItems: {
    id: "ctx_drizzle",
    workspaceId: "ws_drizzle",
    type: "note",
    scope: "room",
    content: "Fact",
    source: "{}",
    visibility: "{}",
    status: "draft",
    version: 1,
    createdBy: "user",
    pinned: 0,
    createdAt: 1,
    updatedAt: 1
  },
  contextVersions: { contextId: "ctx_drizzle", version: 1, payload: "{}", changedBy: "user", changedAt: 1 },
  permissionProfiles: { id: "pp_drizzle", name: "Strict", payload: "{}", createdAt: 1, updatedAt: 1 },
  permissionRules: {
    id: "rule_drizzle",
    workspaceId: "ws_drizzle",
    resourceType: "file",
    resourceMatch: "*.ts",
    action: "ask",
    remember: 0,
    createdAt: 1
  },
  permissionRequests: { id: "preq_drizzle", workspaceId: "ws_drizzle", resource: "{}", status: "pending", rememberDecision: 0, createdAt: 1 },
  interventions: {
    id: "int_drizzle",
    workspaceId: "ws_drizzle",
    roomId: "room_drizzle",
    sourceAgentId: "agent_drizzle",
    type: "knock",
    reason: "Review",
    priority: "medium",
    status: "pending_user_decision",
    createdAt: 1
  },
  artifacts: {
    id: "art_drizzle",
    workspaceId: "ws_drizzle",
    type: "diff",
    title: "Patch",
    status: "draft",
    metadata: "{}",
    createdAt: 1,
    updatedAt: 1
  },
  artifactFiles: { artifactId: "art_drizzle", path: "src/a.ts", fileStatus: "modified", createdAt: 1 },
  mailboxMessages: {
    id: "mb_drizzle",
    workspaceId: "ws_drizzle",
    roomId: "room_drizzle",
    toAgentId: "agent_drizzle",
    kind: "note",
    content: "hello",
    files: "[]",
    read: 0,
    createdAt: 1
  },
  pendingTurns: {
    id: "pt_drizzle",
    roomId: "room_drizzle",
    userMessageId: "msg_drizzle",
    primaryAgentId: "agent_drizzle",
    status: "queued",
    enqueuedAt: 1
  },
  runNextTurns: {
    id: "nt_drizzle",
    runId: "run_drizzle",
    roomId: "room_drizzle",
    agentId: "agent_drizzle",
    promptDeltaJson: "{}",
    createdAt: 1
  },
  mailboxDeliveries: { deliveryBatchId: "batch_drizzle", runId: "run_drizzle", mailboxIds: "[]", nextTurnIds: "[]", deliveredAt: 1 },
  authTokens: { id: "tok_drizzle", fingerprint: "fp", hash: "hash", scopes: "[]", createdAt: 1 },
  sessions: { sessionId: "sess_drizzle", csrfTokenHash: "csrf", createdAt: 1, expiresAt: 2 },
  outbox: { eventId: "evt_drizzle", seq: 1, status: "pending", attempts: 0, enqueuedAt: 1 },
  handlerCursors: { handlerName: "handler_drizzle", lastSeq: 1, updatedAt: 1 },
  deadLetterEvents: {
    id: "dlq_drizzle",
    handlerName: "handler_drizzle",
    eventId: "evt_drizzle",
    eventSeq: 1,
    attempts: 5,
    lastError: "err",
    failedAt: 1,
    status: "unresolved"
  },
  runLocks: { lockType: "workspace", lockKey: "ws_drizzle", workspaceId: "ws_drizzle", runId: "run_drizzle", acquiredAt: 1 },
  commandRecords: {
    actorType: "user",
    actorId: "user_drizzle",
    idempotencyKey: "key",
    commandType: "WakeAgent",
    commandHash: "hash",
    status: "succeeded",
    createdAt: 1,
    expiresAt: 2
  }
} as const;

beforeEach(() => {
  db = new Database(":memory:");
  applySqlitePragmas(db);
});

afterEach(() => {
  db?.close();
  db = undefined;
});

function applyAllMigrations(): void {
  const sqlite = currentDb();
  const applied = applyMigrations(sqlite);
  expect(applied.map((migration) => migration.id)).toEqual([
    "0001_init.sql",
    "0002_messages.sql",
    "0003_events.sql",
    "0004_runs_tasks.sql",
    "0005_context.sql",
    "0006_permissions.sql",
    "0007_interventions.sql",
    "0008_artifacts.sql",
    "0009_mailbox.sql",
    "0010_auth.sql",
    "0011_bus_runtime.sql",
    "0012_v05.sql",
    "0013_messages_pinned.sql",
    "0014_v10.sql"
  ]);
}

function currentDb(): Sqlite {
  expect(db).toBeDefined();
  return db as Sqlite;
}

function tableNames(): string[] {
  return currentDb()
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all()
    .map((row) => (row as { name: string }).name);
}

function columnNames(tableName: string): string[] {
  return currentDb()
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .map((row) => (row as { name: string }).name);
}

function tableInfo(tableName: string): Array<{ name: string; type: string; notnull: number; dflt_value: string | null }> {
  return currentDb().prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
  }>;
}

function indexNames(tableName: string): string[] {
  return currentDb()
    .prepare(`PRAGMA index_list(${tableName})`)
    .all()
    .map((row) => (row as { name: string }).name);
}

function indexSql(indexName: string): string {
  const row = currentDb().prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(indexName) as
    | { sql: string | null }
    | undefined;
  return row?.sql ?? "";
}

function countRows(tableName: string): number {
  return (currentDb().prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number }).count;
}

function smokeCrud(tableName: string, insertSql: string, params: readonly unknown[] = []): void {
  currentDb().prepare(insertSql).run(...params);
  expect(countRows(tableName)).toBe(1);
  currentDb().prepare(`DELETE FROM ${tableName}`).run();
  expect(countRows(tableName)).toBe(0);
}

function drizzleColumnNames(table: DrizzleTable): string[] {
  return Object.values(getTableColumns(table)).map((column) => column.name).sort();
}

describe("SQLite pragmas and migrations", () => {
  test("applies local-first SQLite pragmas", () => {
    currentDb().close();
    db = undefined;
    const tempDir = mkdtempSync(join(tmpdir(), "agenthub-db-"));
    const fileDb = new Database(join(tempDir, "agenthub.sqlite"));
    try {
      applySqlitePragmas(fileDb);
      expect((fileDb.pragma("journal_mode") as Array<{ journal_mode: string }>)[0]?.journal_mode).toBe("wal");
      expect((fileDb.pragma("synchronous") as Array<{ synchronous: number }>)[0]?.synchronous).toBe(1);
      expect((fileDb.pragma("foreign_keys") as Array<{ foreign_keys: number }>)[0]?.foreign_keys).toBe(1);
      expect((fileDb.pragma("busy_timeout") as Array<{ timeout: number }>)[0]?.timeout).toBe(5000);
      expect((fileDb.pragma("temp_store") as Array<{ temp_store: number }>)[0]?.temp_store).toBe(2);
      expect((fileDb.pragma("mmap_size") as Array<{ mmap_size: number }>)[0]?.mmap_size).toBe(268435456);
      expect((fileDb.pragma("page_size") as Array<{ page_size: number }>)[0]?.page_size).toBe(4096);
    } finally {
      fileDb.close();
      rmSync(tempDir, { recursive: true, force: true });
      db = new Database(":memory:");
    }
  });

  test("applies all migrations once and records them", () => {
    applyAllMigrations();
    expect(countRows("__agenthub_migrations")).toBe(14);
    expect(applyMigrations(currentDb())).toEqual([]);

    expect(tableNames()).toEqual([
      "__agenthub_migrations",
      "agent_bindings",
      "agent_presence",
      "agent_profiles",
      "artifact_files",
      "artifacts",
      "attachments",
      "auth_tokens",
      "command_records",
      "context_items",
      "context_versions",
      "dead_letter_events",
      "events",
      "handler_cursors",
      "interventions",
      "mailbox_deliveries",
      "mailbox_messages",
      "message_parts",
      "messages",
      "model_configs",
      "outbox",
      "pending_turns",
      "permission_profiles",
      "permission_requests",
      "permission_rules",
      "role_drafts",
      "roles",
      "room_participants",
      "rooms",
      "run_locks",
      "run_next_turns",
      "runs",
      "runtimes",
      "sessions",
      "task_activities",
      "task_runs",
      "tasks",
      "workspaces"
    ]);
  });

  test("creates core and v1.0 indexes and columns exactly once", () => {
    applyAllMigrations();

    expect(columnNames("events")).toContain("visibility");
    expect(columnNames("events").filter((name) => name === "visibility")).toHaveLength(1);
    expect(indexNames("events")).toEqual(
      expect.arrayContaining([
        "idx_events_seq",
        "idx_events_workspace_created",
        "idx_events_room_created",
        "idx_events_run_created",
        "idx_events_trace",
        "idx_events_type_created",
        "idx_events_room_visibility"
      ])
    );

    expect(indexNames("messages")).toEqual(
      expect.arrayContaining(["idx_messages_room_created", "idx_messages_room_created_desc", "idx_messages_pending"])
    );
    expect(indexNames("runs")).toContain("idx_runs_workspace_ended");
    expect(indexNames("run_next_turns")).toEqual(
      expect.arrayContaining(["idx_next_turns_run_unconsumed", "idx_next_turns_room_agent"])
    );
    expect(indexSql("idx_next_turns_run_unconsumed")).toContain("WHERE consumed_at IS NULL");
    expect(indexNames("mailbox_deliveries")).toContain("idx_mailbox_deliveries_run");
    expect(indexNames("outbox")).toContain("idx_outbox_pending");
    expect(indexSql("idx_outbox_pending")).toContain("WHERE status = 'pending'");

    expect(columnNames("rooms")).toContain("leader_role_id");
    expect(columnNames("room_participants")).toContain("agent_binding_id");
    expect(columnNames("tasks")).toEqual(
      expect.arrayContaining(["assignee_role_id", "assignee_binding_id", "delegation_chain", "expects_review"])
    );
    expect(columnNames("tasks").filter((name) => name === "priority")).toHaveLength(1);
    expect(columnNames("roles")).toEqual(expect.arrayContaining(["avatar", "default_permission_profile_id", "is_builtin", "tags"]));
    expect(columnNames("runtimes")).toEqual(expect.arrayContaining(["detected_path", "detected_version", "kind", "manifest_json", "status", "supported_caps"]));
    expect(columnNames("model_configs")).toEqual(expect.arrayContaining(["api_key_ref", "api_key_fingerprint", "name", "profile", "temperature", "max_tokens", "reasoning", "extra"]));
    expect(columnNames("role_drafts")).toEqual(
      expect.arrayContaining(["job_id", "description", "model_config_id", "draft_json", "status", "failure_reason", "expires_at"])
    );
    expect(columnNames("task_activities")).toEqual(
      expect.arrayContaining(["task_id", "kind", "by_kind", "by", "payload"])
    );
    expect(indexNames("agent_bindings")).toEqual(
      expect.arrayContaining(["idx_agent_bindings_role", "idx_agent_bindings_runtime"])
    );
    expect(indexNames("role_drafts")).toContain("idx_role_drafts_expires_at");
    expect(indexSql("idx_role_drafts_expires_at")).toContain("expires_at");
    expect(indexNames("task_activities")).toContain("idx_task_activities_task_created");

    const modelConfigApiKeyRef = tableInfo("model_configs").find((column) => column.name === "api_key_ref");
    expect(modelConfigApiKeyRef?.notnull).toBe(0);

    const rolesIsBuiltin = tableInfo("roles").find((column) => column.name === "is_builtin");
    expect(rolesIsBuiltin?.type).toBe("INTEGER");
    expect(rolesIsBuiltin?.notnull).toBe(1);
    expect(rolesIsBuiltin?.dflt_value).toBe("0");
  });

  test("creates run_locks schema required by bus runtime", () => {
    applyAllMigrations();

    expect(columnNames("run_locks")).toEqual(["lock_type", "lock_key", "workspace_id", "run_id", "acquired_at"]);
    expect(indexNames("run_locks")).toEqual(
      expect.arrayContaining(["idx_run_locks_runid", "idx_run_locks_workspace", "sqlite_autoindex_run_locks_1"])
    );
    smokeCrud(
      "run_locks",
      "INSERT INTO run_locks (lock_type, lock_key, workspace_id, run_id, acquired_at) VALUES (?, ?, ?, ?, ?)",
      ["workspace", "ws_1", "ws_1", "run_1", 1]
    );
  });
});

describe("Drizzle schema and migration drift contract", () => {
  beforeEach(() => {
    applyAllMigrations();
  });

  test("exports one Drizzle table per migrated application table", () => {
    const migratedTables = tableNames().filter((tableName) => tableName !== "__agenthub_migrations");
    const exportedTables = drizzleTables.map(({ table }) => getTableName(table)).sort();

    expect(exportedTables).toEqual(migratedTables);
  });

  test("every exported Drizzle column exists in the migrated table", () => {
    for (const { exportName, table } of drizzleTables) {
      const tableName = getTableName(table);
      expect(drizzleColumnNames(table), `${String(exportName)} columns`).toEqual(columnNames(tableName).sort());
    }
  });

  test("createDatabase Drizzle exports can insert, select, and delete against migrated SQLite", () => {
    currentDb().close();
    db = undefined;
    const tempDir = mkdtempSync(join(tmpdir(), "agenthub-db-drizzle-"));
    const database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });

    try {
      for (const { exportName, table } of drizzleTables) {
        database.drizzle.insert(table).values(drizzleSmokeRows[exportName]).run();
        const rows = database.drizzle.select().from(table).all();
        expect(rows, `${String(exportName)} select`).toHaveLength(1);
        database.drizzle.delete(table).run();
        expect(database.drizzle.select({ count: sql<number>`count(*)` }).from(table).get()?.count).toBe(0);
      }
    } finally {
      database.sqlite.close();
      rmSync(tempDir, { recursive: true, force: true });
      db = new Database(":memory:");
    }
  });
});

describe("table-family CRUD smoke", () => {
  beforeEach(() => {
    applyAllMigrations();
  });

  test("workspace, room, and agent tables", () => {
    smokeCrud("workspaces", "INSERT INTO workspaces VALUES ('ws_1', 'Workspace', '/tmp/ws', 1, 1)");
    smokeCrud(
      "rooms",
      "INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'solo', 'room', 1, 1)"
    );
    smokeCrud(
      "room_participants",
      "INSERT INTO room_participants (room_id, participant_id, participant_type, role, joined_at) VALUES ('room_1', 'agent_1', 'agent', 'primary', 1)"
    );
    smokeCrud(
      "agent_profiles",
      "INSERT INTO agent_profiles (id, name, adapter_id, role_prompt, created_at, updated_at) VALUES ('agent_1', 'Builder', 'mock', 'Build', 1, 1)"
    );
    smokeCrud(
      "agent_presence",
      "INSERT INTO agent_presence (room_id, agent_id, state, updated_at) VALUES ('room_1', 'agent_1', 'observing', 1)"
    );
  });

  test("message family tables", () => {
    smokeCrud(
      "messages",
      "INSERT INTO messages (id, workspace_id, room_id, sender_type, role, status, created_at, updated_at) VALUES ('msg_1', 'ws_1', 'room_1', 'user', 'user', 'created', 1, 1)"
    );
    smokeCrud(
      "message_parts",
      "INSERT INTO message_parts (message_id, seq, part_type, payload, created_at) VALUES ('msg_1', 1, 'text', '{\"text\":\"hi\"}', 1)"
    );
    smokeCrud(
      "attachments",
      "INSERT INTO attachments (id, message_id, file_id, file_name, byte_size, storage_path, created_at) VALUES ('att_1', 'msg_1', 'file_1', 'a.txt', 1, '/tmp/a.txt', 1)"
    );
  });

  test("event family table", () => {
    smokeCrud(
      "events",
      "INSERT INTO events (id, seq, type, schema_version, visibility, payload, created_at) VALUES ('evt_1', 1, 'message.created', 1, 'both', '{}', 1)"
    );
  });

  test("run and task family tables", () => {
    smokeCrud(
      "tasks",
      "INSERT INTO tasks (id, workspace_id, title, status, created_at, updated_at) VALUES ('task_1', 'ws_1', 'Task', 'open', 1, 1)"
    );
    smokeCrud(
      "runs",
      "INSERT INTO runs (id, workspace_id, room_id, agent_id, status, created_at, updated_at) VALUES ('run_1', 'ws_1', 'room_1', 'agent_1', 'queued', 1, 1)"
    );
    smokeCrud(
      "task_runs",
      "INSERT INTO task_runs (id, task_id, run_id, created_at) VALUES ('tr_1', 'task_1', 'run_1', 1)"
    );
  });

  test("context family tables", () => {
    smokeCrud(
      "context_items",
      "INSERT INTO context_items (id, workspace_id, type, scope, content, status, version, created_by, created_at, updated_at) VALUES ('ctx_1', 'ws_1', 'note', 'room', 'Fact', 'draft', 1, 'user', 1, 1)"
    );
    smokeCrud(
      "context_versions",
      "INSERT INTO context_versions (context_id, version, payload, changed_by, changed_at) VALUES ('ctx_1', 1, '{}', 'user', 1)"
    );
  });

  test("permission family tables", () => {
    smokeCrud(
      "permission_profiles",
      "INSERT INTO permission_profiles (id, name, payload, created_at, updated_at) VALUES ('pp_1', 'Strict', '{}', 1, 1)"
    );
    smokeCrud(
      "permission_rules",
      "INSERT INTO permission_rules (id, workspace_id, resource_type, resource_match, action, created_at) VALUES ('rule_1', 'ws_1', 'file', '*.ts', 'ask', 1)"
    );
    smokeCrud(
      "permission_requests",
      "INSERT INTO permission_requests (id, workspace_id, resource, status, created_at) VALUES ('preq_1', 'ws_1', '{}', 'pending', 1)"
    );
  });

  test("intervention family table", () => {
    smokeCrud(
      "interventions",
      "INSERT INTO interventions (id, workspace_id, room_id, source_agent_id, type, reason, priority, status, created_at) VALUES ('int_1', 'ws_1', 'room_1', 'agent_1', 'knock', 'Review', 'medium', 'pending_user_decision', 1)"
    );
  });

  test("artifact family tables", () => {
    smokeCrud(
      "artifacts",
      "INSERT INTO artifacts (id, workspace_id, type, title, status, created_at, updated_at) VALUES ('art_1', 'ws_1', 'diff', 'Patch', 'draft', 1, 1)"
    );
    smokeCrud(
      "artifact_files",
      "INSERT INTO artifact_files (artifact_id, path, file_status, created_at) VALUES ('art_1', 'src/a.ts', 'modified', 1)"
    );
  });

  test("mailbox and next-turn family tables", () => {
    smokeCrud(
      "mailbox_messages",
      "INSERT INTO mailbox_messages (id, workspace_id, room_id, to_agent_id, kind, content, created_at) VALUES ('mb_1', 'ws_1', 'room_1', 'agent_1', 'note', 'hello', 1)"
    );
    smokeCrud(
      "pending_turns",
      "INSERT INTO pending_turns (id, room_id, user_message_id, primary_agent_id, status, enqueued_at) VALUES ('pt_1', 'room_1', 'msg_1', 'agent_1', 'queued', 1)"
    );
    smokeCrud(
      "run_next_turns",
      "INSERT INTO run_next_turns (id, run_id, room_id, agent_id, prompt_delta_json, created_at) VALUES ('nt_1', 'run_1', 'room_1', 'agent_1', '{}', 1)"
    );
    smokeCrud(
      "mailbox_deliveries",
      "INSERT INTO mailbox_deliveries (delivery_batch_id, run_id, mailbox_ids, next_turn_ids, delivered_at) VALUES ('batch_1', 'run_1', '[]', '[]', 1)"
    );
  });

  test("auth family tables", () => {
    smokeCrud(
      "auth_tokens",
      "INSERT INTO auth_tokens (id, fingerprint, hash, scopes, created_at) VALUES ('tok_1', 'fp', 'hash', '[]', 1)"
    );
    smokeCrud(
      "sessions",
      "INSERT INTO sessions (session_id, csrf_token_hash, created_at, expires_at) VALUES ('sess_1', 'csrf', 1, 2)"
    );
  });

  test("bus runtime family tables", () => {
    smokeCrud(
      "outbox",
      "INSERT INTO outbox (event_id, seq, status, enqueued_at) VALUES ('evt_1', 1, 'pending', 1)"
    );
    smokeCrud(
      "handler_cursors",
      "INSERT INTO handler_cursors (handler_name, last_seq, updated_at) VALUES ('handler', 1, 1)"
    );
    smokeCrud(
      "dead_letter_events",
      "INSERT INTO dead_letter_events (id, handler_name, event_id, event_seq, attempts, last_error, failed_at, status) VALUES ('dlq_1', 'handler', 'evt_1', 1, 5, 'err', 1, 'unresolved')"
    );
    smokeCrud(
      "command_records",
      "INSERT INTO command_records (actor_type, actor_id, idempotency_key, command_type, command_hash, status, created_at, expires_at) VALUES ('user', 'user_1', 'key', 'WakeAgent', 'hash', 'succeeded', 1, 2)"
    );
  });
});
