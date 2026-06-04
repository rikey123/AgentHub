import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus } from "@agenthub/bus";
import { createDatabase, type AgentHubDatabase } from "@agenthub/db";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { persistAssistantPublicMessage, type FileMessageService, type RunRow } from "../src/index.ts";

let tempDir: string | undefined;
let database: AgentHubDatabase | undefined;
let eventBus: EventBus | undefined;
let now = 1_000;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agenthub-public-message-"));
  database = createDatabase({ path: join(tempDir, "agenthub.sqlite"), applyMigrations: true });
  eventBus = new EventBus({ database: currentDatabase() });
  seedRoom();
});

afterEach(() => {
  currentBus().close();
  currentDatabase().sqlite.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
  database = undefined;
  eventBus = undefined;
  now = 1_000;
});

describe("persistAssistantPublicMessage", () => {
  test("keeps ordinary role-play follow-up chat as text without forcing a file", () => {
    const text = [
      "我接着 PM 那句补一下：先别急着堆 agent，得先把每个人在群里该不该开口定清楚。",
      "从 Builder 的角度看，第一版就做一个 selector 加共享上下文，别一上来搞复杂工作流。"
    ].join("\n");
    const createdFiles: Array<Parameters<FileMessageService["createFromContent"]>[0]> = [];

    const publicText = persistAssistantPublicMessage({
      database: currentDatabase(),
      eventBus: currentBus(),
      run: runRow(),
      messageId: "msg_run_1",
      text,
      fileMessageService: {
        createFromContent(input) {
          createdFiles.push(input);
          return {
            artifactId: "artifact_unexpected",
            path: input.path,
            name: input.path.split("/").at(-1) ?? input.path,
            mimeType: input.mimeType,
            sizeBytes: Buffer.byteLength(input.content, "utf8"),
            previewKind: input.previewKind
          };
        }
      },
      now: () => now
    });

    expect(publicText).toBe(text);
    expect(createdFiles).toHaveLength(0);
    const parts = currentDatabase().sqlite.prepare("SELECT part_type FROM message_parts WHERE message_id = 'msg_run_1' ORDER BY seq ASC").all() as Array<{ readonly part_type: string }>;
    expect(parts.map((part) => part.part_type)).toEqual(["text"]);
  });

  test("stores a conversational lead-in separately from a substantial deliverable file", () => {
    const longText = [
      "我补一个“交互层”的正式方案：多 agent 不是把多个 LLM 放一起，而是把协作协议设计出来。",
      "",
      "# 多 Agent 交互层方案",
      "",
      "## 1. 角色层",
      "角色层需要定义每个房间成员的身份、发言边界、默认语气和是否具备收束责任。",
      "",
      "## 2. 通信层",
      "通信层需要区分公开群聊、私有 mailbox、文件卡和任务状态，避免把所有内容都塞进聊天气泡。",
      "",
      "## 3. 控制层",
      "控制层需要记录上一位发言者、候选发言者、终止条件和选择理由，保证群聊能继续也能停下来。",
      "",
      "## 4. 记忆层",
      "记忆层需要把本轮上下文和历史文件摘录传给后续发言者，让第二个人真的看见第一个人的观点。"
    ].join("\n");
    const createdFiles: Array<Parameters<FileMessageService["createFromContent"]>[0]> = [];

    const publicText = persistAssistantPublicMessage({
      database: currentDatabase(),
      eventBus: currentBus(),
      run: runRow(),
      messageId: "msg_run_1",
      text: longText,
      fileMessageService: {
        createFromContent(input) {
          createdFiles.push(input);
          return {
            artifactId: "artifact_1",
            path: input.path,
            name: input.path.split("/").at(-1) ?? input.path,
            mimeType: input.mimeType,
            sizeBytes: Buffer.byteLength(input.content, "utf8"),
            previewKind: input.previewKind
          };
        }
      },
      now: () => now
    });

    expect(publicText).toContain("详细内容见文件");
    expect(publicText).toContain("我的核心观点是");
    expect(publicText).not.toBe("我补一个“交互层”的正式方案：多 agent 不是把多个 LLM 放一起，而是把协作协议设计出来。");
    expect(createdFiles).toHaveLength(1);
    expect(createdFiles[0]).toMatchObject({
      title: "头脑风暴引导助手 reply",
      path: expect.stringMatching(/^agent-replies\/头脑风暴引导助手-run_1\.md$/u),
      content: longText
    });

    const parts = currentDatabase().sqlite.prepare("SELECT part_type, payload FROM message_parts WHERE message_id = 'msg_run_1' ORDER BY seq ASC").all() as Array<{ readonly part_type: string; readonly payload: string }>;
    expect(parts.map((part) => part.part_type)).toEqual(["text", "attachment"]);
    expect(JSON.parse(parts[0]!.payload)).toMatchObject({ text: publicText });
    expect(JSON.parse(parts[1]!.payload)).toMatchObject({
      artifactId: "artifact_1",
      path: "agent-replies/头脑风暴引导助手-run_1.md",
      name: "头脑风暴引导助手-run_1.md"
    });
  });

  test("preserves teammate handoff phrasing in the public lead-in", () => {
    const longText = [
      "我接着 Project Manager 说的“协作结构”补一句：先把谁能插话、谁负责收束定清楚。",
      "",
      "# 协作结构补充方案",
      "",
      "## 1. 发言权控制",
      "记录候选发言者、上一位发言者和用户显式 @mention，避免所有 agent 同时输出。",
      "",
      "## 2. 文件产物沉淀",
      "只有正式方案、表格、清单和长报告进入文件；普通补充仍然留在聊天里。",
      "",
      "## 3. 终止条件",
      "当已有明确收束、达到 turn budget 或用户发来新消息时停止当前群聊轮次。",
      "",
      "## 4. 上下文引用",
      "后续发言者必须看到前一位的公开消息和文件摘录，才能针对具体观点补充。"
    ].join("\n");

    const publicText = persistAssistantPublicMessage({
      database: currentDatabase(),
      eventBus: currentBus(),
      run: runRow(),
      messageId: "msg_run_1",
      text: longText,
      fileMessageService: {
        createFromContent(input) {
          return {
            artifactId: "artifact_handoff",
            path: input.path,
            name: input.path.split("/").at(-1) ?? input.path,
            mimeType: input.mimeType,
            sizeBytes: Buffer.byteLength(input.content, "utf8"),
            previewKind: input.previewKind
          };
        }
      },
      now: () => now
    });

    expect(publicText).toContain("我接着 Project Manager 说的“协作结构”补一句");
    expect(publicText).toContain("详细内容见文件");
    expect(publicText).not.toContain("我的核心观点是");
  });

  test("keeps document fallback for substantial structured deliverables", () => {
    const longText = [
      "# 多 Agent 助手架构说明",
      "",
      "这是一份面向实现的正式文档，包含模块边界、状态机、风险和落地步骤。",
      "",
      "## 1. 角色模型",
      "角色模型需要区分发言者、执行者、审阅者和归档者。",
      "",
      "## 2. 调度模型",
      "调度模型需要记录候选人、上一位发言者、终止条件和选择理由。",
      "",
      "## 3. 文档模型",
      "只有正式方案、清单、表格、长报告或可复用产物才应该进入文件。",
      "",
      "## 4. 交互模型",
      "聊天消息保持短句，文件用于专业详实的交付物。",
      "",
      "## 5. 验证模型",
      "需要覆盖 selector、prompt、文件卡和 durable replay。"
    ].join("\n");
    const createdFiles: Array<Parameters<FileMessageService["createFromContent"]>[0]> = [];

    const publicText = persistAssistantPublicMessage({
      database: currentDatabase(),
      eventBus: currentBus(),
      run: runRow(),
      messageId: "msg_run_1",
      text: longText,
      fileMessageService: {
        createFromContent(input) {
          createdFiles.push(input);
          return {
            artifactId: "artifact_report",
            path: input.path,
            name: input.path.split("/").at(-1) ?? input.path,
            mimeType: input.mimeType,
            sizeBytes: Buffer.byteLength(input.content, "utf8"),
            previewKind: input.previewKind
          };
        }
      },
      now: () => now
    });

    expect(publicText).toContain("详细内容见文件");
    expect(createdFiles).toHaveLength(1);
    expect(createdFiles[0]?.content).toBe(longText);
  });
});

function currentDatabase(): AgentHubDatabase {
  expect(database).toBeDefined();
  return database as AgentHubDatabase;
}

function currentBus(): EventBus {
  expect(eventBus).toBeDefined();
  return eventBus as EventBus;
}

function seedRoom(): void {
  currentDatabase().sqlite.prepare("INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES ('ws_1', 'Workspace', '.', ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO roles (id, workspace_id, name, prompt, capabilities, is_builtin, created_at, updated_at) VALUES ('role_brainstorm', 'ws_1', '头脑风暴引导助手', '', '[\"chat\"]', 0, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO agent_bindings (id, workspace_id, role_id, runtime_id, model_config_id, override_permission_profile_id, created_at, updated_at) VALUES ('binding_brainstorm', 'ws_1', 'role_brainstorm', 'runtime_1', NULL, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO agent_profiles (id, workspace_id, name, adapter_id, model, role_prompt, capabilities, permission_profile_id, hidden, source_path, created_at, updated_at) VALUES ('agent_1', 'ws_1', 'Runtime Shell', 'native', NULL, '', '{}', NULL, 0, NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO rooms (id, workspace_id, title, mode, default_context_scope, primary_agent_id, archived_at, created_at, updated_at) VALUES ('room_1', 'ws_1', 'Room', 'assisted', 'conversation', 'agent_1', NULL, ?, ?)").run(now, now);
  currentDatabase().sqlite.prepare("INSERT INTO room_participants (room_id, participant_id, participant_type, role, adapter_id, adapter_session_id, agent_binding_id, default_presence, joined_at) VALUES ('room_1', 'agent_1', 'agent', 'primary', 'native', NULL, 'binding_brainstorm', 'active', ?)").run(now);
  currentDatabase().sqlite.prepare("INSERT INTO runs (id, workspace_id, task_id, room_id, agent_id, adapter_id, adapter_session_id, provider_conversation_id, parent_run_id, status, wake_reason, waiting_reason, workspace_path, work_dir, workspace_mode, context_version, target_files, mailbox_claim_count, pid_at_start, claimed_at, started_at, ended_at, input_tokens, output_tokens, cached_tokens, cost_usd, model_id, failure_class, error, created_at, updated_at) VALUES ('run_1', 'ws_1', NULL, 'room_1', 'agent_1', 'native', NULL, NULL, NULL, 'running', 'primary_turn', NULL, NULL, NULL, NULL, NULL, '[]', 0, NULL, NULL, ?, NULL, 0, 0, 0, 0, NULL, NULL, NULL, ?, ?)").run(now, now, now);
  currentDatabase().sqlite.prepare("INSERT INTO messages (id, workspace_id, room_id, sender_type, sender_id, run_id, role, status, quoted_message_id, turn_dispatch_mode, pending_turn_id, created_at, updated_at, deleted_at) VALUES ('msg_run_1', 'ws_1', 'room_1', 'agent', 'agent_1', 'run_1', 'assistant', 'streaming', NULL, 'immediate', NULL, ?, ?, NULL)").run(now, now);
}

function runRow(): RunRow {
  return currentDatabase().sqlite.prepare("SELECT * FROM runs WHERE id = 'run_1'").get() as RunRow;
}
