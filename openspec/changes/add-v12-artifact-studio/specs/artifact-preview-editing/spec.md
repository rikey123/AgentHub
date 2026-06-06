# artifact-preview-editing Specification

## Purpose

实现对话式产物 Studio 的核心体验：Web/Document/Presentation 产物流水线、Artifact 预览、Monaco 编辑器、版本历史、选区引用入聊天（`@artifact` / `@workspace` pill 语法）。

## ADDED Requirements

### Requirement: Web/Document/Presentation 产物流水线

The system SHALL support generating web page, document, and presentation artifacts through conversation, constrained by builtin SKILL.md packages.

**六个 builtin skill（V1.2 新增）：**

| Skill name | artifact kind | 核心约束 |
|-----------|--------------|---------|
| `web-page-builder` | `web_page` | 单文件 self-contained HTML，无外部 CDN，responsive，ARIA 无障碍 |
| `web-app-builder` | `web_app` | 单文件 HTML + 内联 JS，localStorage 持久化，无网络依赖 |
| `one-pager-builder` | `web_page` | 商业简报 one-pager，固定布局，可打印 |
| `html-slides-builder` | `presentation` | HTML 幻灯片，内联 CSS/JS，键盘方向键/触控翻页 |
| `document-builder` | `document` | Markdown 文档，带 YAML frontmatter（title/date/author/tags）|
| `officecli-pptx` | `presentation_pptx` | 使用 officecli 生成/编辑真实 `.pptx`；输出通过 `room.publish_artifact({ kind: "presentation_pptx", filePath })` 提交 |

每个 skill 的 SKILL.md frontmatter 包含 `artifact_kind` 字段。当 Agent 调用 `room.publish_artifact` 时，daemon 依据 skill 的 `artifact_kind` 设置 `artifacts.kind`。

**publish_artifact 流程（同一 SQLite 事务）：**

文本产物（web_page / web_app / document / presentation / source_code）：
1. 写 `artifacts` 行
2. 写 / 更新 `artifact_files` 行（`new_content = 内容`，`binary = 0`）
3. 写 `artifact_versions` 行（`version=1`，`content = 内容快照`，`content_encoding='text'`）
4. 发 `artifact.version.created`（durable, both）
5. 写 message part（type='artifact', partRef=artifactId）
6. 发 `message.part.added`（durable, both）

二进制产物（presentation_pptx）：
1. 写 `artifacts` 行
2. 将文件从 workspace 复制到 `.agenthub/artifacts/<id>/v1/<filename>`
3. 写 `artifact_files` 行（`content_path = 受控路径`，`binary = 1`，`new_sha256`，`mime_type`，`size_bytes`，`new_content = NULL`）
4. 写 `artifact_versions` 行（`storage_path = 受控路径`，`content_encoding='binary'`，`content = NULL`）
5. 发 `artifact.version.created`（durable, both）
6. 写 message part
7. 发 `message.part.added`（durable, both）

**Card 路由：**

| kind | Card |
|------|------|
| `web_page`, `web_app` | PreviewCard（sandbox iframe）|
| `presentation` | PresentationCard（HTML slides viewer）|
| `presentation_pptx` | PresentationCard（PptViewer / officecli watch iframe）|
| `document` | DocumentCard（Markdown renderer）|
| `source_code` | ArtifactCard（Monaco / syntax highlight）|
| `generic_file` | ArtifactCard（raw / download）|
| `diff`, `worktree_diff` | DiffCard（现有）|
| `terminal` | TerminalCard（现有）|

#### Scenario: Agent 生成网页，聊天流出现 PreviewCard

- **WHEN** Agent 通过 `web-page-builder` skill 生成 HTML，调用 `room.publish_artifact({ kind: "web_page", content: "<html>...", filename: "landing.html" })`
- **THEN** 聊天流出现 PreviewCard，iframe 预览该 HTML；不需要刷新

#### Scenario: Agent 生成文档，聊天流出现 DocumentCard

- **WHEN** Agent 通过 `document-builder` skill 生成 Markdown 文档，调用 `room.publish_artifact({ kind: "document", content: "# 标题\n...", filename: "report.md" })`
- **THEN** 聊天流出现 DocumentCard，渲染 Markdown 内容

---

### Requirement: Artifact 预览

The system SHALL render artifact content inline in the chat and in a full-screen preview modal, with type-appropriate rendering.

**PreviewCard（web_page / web_app）：**
- 内嵌 sandbox iframe，`sandbox="allow-scripts"`（不开放 allow-same-origin）
- iframe src 指向 daemon preview server 颁发的短期 token URL（独立端口）
- 操作区：Edit / Deploy / Download / Expand（全屏）

**DocumentCard（document）：**
- 内嵌 Markdown renderer（sanitized HTML，不执行脚本）
- 操作区：Edit / Download / Expand

**PresentationCard（presentation）：**
- 内嵌 HTML slides viewer：
  - 显示第 1 页幻灯片缩略图 + "N 页" 标注
  - 点击 Expand 进入全屏幻灯片模式
  - 全屏模式：方向键 / 左右滑动翻页，ESC 退出
- 操作区：Edit / Download / Expand

**ArtifactPreviewModal（全屏）：**

所有 Card 点击 Expand 后打开 `ArtifactPreviewModal`，包含以下 tab：

| Tab | 显示条件 | 内容 |
|-----|---------|------|
| Preview | 所有 kind | type-appropriate 渲染 |
| Editor | kind != diff/worktree_diff/terminal | Monaco 编辑器 |
| History | 有 artifact_versions | 版本历史列表 |
| Raw | 所有 kind | 原始内容 + Copy 按钮 |

#### Scenario: HTML 预览严格沙箱

- **WHEN** 用户展开一个 web_page artifact 的 PreviewCard
- **THEN** iframe 使用 `sandbox="allow-scripts"`，预览页 JS 无法访问 daemon API（CORS + same-origin 缺失双层防御）

#### Scenario: HTML slides 全屏翻页

- **WHEN** 用户打开 PresentationCard 的全屏模式，按右方向键
- **THEN** 幻灯片切换到下一页；按左方向键返回上一页；ESC 退出全屏

---

### Requirement: Artifact 版本历史

The system SHALL record a new version snapshot each time an artifact's content changes, and allow restoring any prior version.

`artifact_versions` 表存储每次保存的内容快照（不可变追加写）。内容存储在 `artifact_files.new_content`；`artifact_versions.content` 是独立快照列。`artifacts` 表**不**新增 `content` 列。

**版本创建触发点：**
1. 用户在 Editor tab 点击 Save（可选 commit message）
2. Agent 对已存在的 artifact 再次调用 `room.publish_artifact`
3. 执行 `POST /artifacts/:id/versions/:version/restore`

**API：**
```
GET    /artifacts/:id/versions                   → 版本列表
GET    /artifacts/:id/versions/:version          → 单个版本详情（含 content）
POST   /artifacts/:id/versions/:version/restore  → 创建新版本（内容 = 指定版本快照）
GET    /artifacts/:id/versions/:from/diff/:to    → 两版本间 unified diff
```

**History tab UI：**
- 版本列表：version number / created_at（相对时间）/ created_by / message
- 点击某版本加载只读预览（带 "当前查看版本 N" 提示）
- "Compare with current" → 只读 DiffModal（unified diff）
- Restore 按钮：创建新版本（内容 = 历史版本快照），更新 `artifact_files.new_content`，发 `artifact.version.created`

#### Scenario: 保存创建新版本

- **WHEN** 用户在 Editor tab 修改内容后点击 Save，输入 message "修改按钮颜色为蓝色"
- **THEN** `artifact_versions` 新增一行（version = 旧版本 + 1，message = "修改按钮颜色为蓝色"）；History tab 出现新条目；artifact card 版本 badge 更新

#### Scenario: 恢复历史版本

- **WHEN** 用户在 History tab 选择版本 2（当前是版本 5），点击 Restore
- **THEN** `artifact_versions` 新增版本 6（content = 版本 2 快照），`artifact_files.new_content` 更新为版本 2 内容；不是 in-place 覆盖，历史始终向前

#### Scenario: Agent 更新产物创建新版本

- **WHEN** Agent 对已存在的 artifact 再次调用 `room.publish_artifact`（例如用户说"把标题改成红色"）
- **THEN** 自动创建新版本（created_by = agentId）；聊天流出现更新后的 Card；旧版本保留在 History tab

---

### Requirement: Artifact Editor（Monaco）

The system SHALL provide a Monaco-based code editor in `ArtifactPreviewModal` for editing artifact content.

**Editor tab 行为：**
- Monaco 编辑器，语言由文件扩展名自动检测（`.html` → html，`.md` → markdown，`.json` → json，无扩展名 → plaintext）
- `Ctrl+S`（Windows/Linux）/ `Cmd+S`（Mac）触发 Save
- Save 按钮：调用 `PATCH /artifacts/:id { content }` → 更新 `artifact_files.new_content` + 写 `artifact_versions` → 发 `artifact.version.created`
- 选中代码后显示悬浮工具栏，包含"Reference in Chat"按钮 → 插入 `@artifact:<id>#L{start}-L{end}` pill

**Editor tab 对以下类型隐藏：** `diff` / `worktree_diff` / `terminal`（这些是只读补丁，不支持文本编辑）。

#### Scenario: 编辑保存

- **WHEN** 用户在 Editor tab 修改 HTML 内容（如改颜色），按 Ctrl+S
- **THEN** 新内容保存为新版本；Preview tab 的 iframe 刷新显示最新内容；History tab 出现新条目

#### Scenario: diff artifact 无 Editor tab

- **WHEN** 用户打开一个 diff artifact 的 ArtifactPreviewModal
- **THEN** 只显示 Preview / Raw / History tab；不显示 Editor tab

---

### Requirement: 选区引用入聊天（@artifact / @workspace pill 语法）

The system SHALL support inserting artifact line-range references into the chat InputBox as interactive pills.

**两种引用 token：**

```
@artifact:<artifactId>#L12-L30    → artifact 指定行范围
@artifact:<artifactId>            → artifact 整体（< 2KB 注入全文，≥ 2KB 注入前 50 行 + 提示）
@workspace:<relativePath>#L5-L20  → workspace 文件指定行范围
```

**插入触发：**
1. 在 Editor tab 选中代码行 → 悬浮工具栏"Reference in Chat"按钮
2. 在 Presentation/Document 选中段落 → 同样有"Reference in Chat"选项
3. 在 ArtifactCard 右键菜单 → "Copy Reference"

**InputBox pill 渲染：** `@filename.html#L12-L30`（蓝色 pill，带 × 删除按钮）；不展开内容，只在发送时解析。

**发送时处理（daemon context-ref resolver）：**
1. 解析消息中的所有 `@artifact:<id>#Lx-Ly` token。
2. 从 `artifact_files.new_content`（当前版本）或 `artifact_versions.content`（历史版本）提取对应行范围。
3. 注入 `<context-ref type="artifact" id="..." lines="12-30">` XML 块到 prompt context assembly（在 MissionBrief 之后、正文上下文之前）。
4. `@workspace:<path>#Lx-Ly` 同理，从 workspace 文件系统读取。

#### Scenario: 选区引用 → Agent 修改

- **WHEN** 用户在 Editor tab 选中第 10-20 行（一段 CSS），点击"Reference in Chat"，InputBox 出现 `@landing.html#L10-L20` pill，用户输入"把背景色改成深蓝"并发送
- **THEN** Agent 收到的 prompt 包含该 10 行代码的 context-ref block；Agent 生成针对这段代码的修改；产出新版本 artifact

#### Scenario: 整体引用大文件截断提示

- **WHEN** 用户插入 `@artifact:<id>`（无行号），该 artifact 内容 15KB
- **THEN** context assembly 注入前 50 行 + 在注入内容末尾附 "（内容已截断，建议用 #Lx-Ly 指定需要修改的具体行）"

#### Scenario: @workspace 文件引用

- **WHEN** 用户在 InputBox 输入 `@workspace:src/auth.ts#L45-L60`
- **THEN** pill 渲染为 `@auth.ts#L45-L60`；发送时 daemon 从 workspace 读取 `src/auth.ts` 第 45-60 行并注入 context

---

### Requirement: 产物下载

The system SHALL support downloading artifact content as a file.

每种 Card 的操作区都有 Download 按钮：

```
GET /artifacts/:id/download
```

响应头：
- `Content-Disposition: attachment; filename="{artifact.filename}"`
- `Content-Type` 根据 artifact kind 设置（`text/html`、`text/markdown`、`text/plain` 等）

#### Scenario: 下载 Markdown 文档

- **WHEN** 用户点击 DocumentCard 上的 Download 按钮
- **THEN** 浏览器下载一个 `.md` 文件，文件名为 artifact 的 filename

---

### Requirement: 真实 PPT/PPTX/ODP 只读预览

The system SHALL support read-only preview of real `.ppt` / `.pptx` / `.odp` files via a local `officecli watch` process, embedded in an iframe (web mode) or webview (desktop mode).

**实现参考（AionUi `pptPreviewBridge.ts`）：**

| 步骤 | 说明 |
|------|------|
| 检测 `officecli` | 执行 `officecli --version`；Windows 可用 `where.exe officecli`；macOS/Linux 可用 `command -v officecli`；`ENOENT` / command not found 时触发自动安装，安装后 retry once，失败后设置 `installFailed`（同 session 内不再重复安装）|
| 启动预览进程 | `officecli watch <filePath> --port <port>`，为每个文件分配独立空闲端口 |
| 等待就绪 | 等待 stdout 出现 `Watch:` 或端口响应 HTTP 200 |
| Web 模式 | 通过 `/api/ppt-proxy/:port/*` 代理（MUST 验证端口属于活跃 preview session，防 SSRF）|
| 嵌入 | `<iframe src="..." title="PPT Preview" />` |
| 卸载 | 组件卸载时停止对应 watch 进程；daemon 退出时停止所有 watch 进程 |

**artifact kind 扩展：** 新增 `presentation_pptx`（区别于 HTML slides 的 `presentation`）：

```
artifacts.kind:
  web_page | web_app | document | presentation | presentation_pptx
  | source_code | generic_file
```

`presentation_pptx` 由文件扩展名检测（`.ppt` / `.pptx` / `.odp`），当 Agent 通过 `room.publish_artifact` 或 `room.send_file_message` 产出真实 PPT 文件时自动设置。

**`PresentationCard` 路由：**
- `kind='presentation'` → HTML slides viewer（已有）
- `kind='presentation_pptx'` → `PptViewer`（officecli watch iframe）

**Agent 产出 PPTX 的聊天流闭环：** Agent 生成 `.pptx` 文件后调用 `room.publish_artifact({ kind: "presentation_pptx", filePath, filename })`；聊天流插入 `PresentationCard`；点击 Expand 打开全屏 PPT 预览。

**缺少 officecli 时的降级：** PresentationCard 显示"需要 officecli 才能预览 PPT，正在安装…"；安装完成后自动刷新预览；安装失败显示错误 + "Download" 按钮。

#### Scenario: PPTX 文件产出全屏预览

- **WHEN** Agent 生成 `deck.pptx` 并调用 `room.publish_artifact({ kind: "presentation_pptx", filename: "deck.pptx" })`
- **THEN** 聊天流出现 PresentationCard（PPT 图标 + 文件名 + 页数）；点击 Expand 启动 `officecli watch` 进程；iframe 显示 PPT 真实预览

#### Scenario: officecli 缺失时自动安装

- **WHEN** 系统检测到 `officecli` 未安装，用户打开 PPTX PresentationCard
- **THEN** PresentationCard 显示"正在安装 officecli…"；安装成功后自动启动预览；安装失败显示错误 + Download 按钮

#### Scenario: PPT proxy 防 SSRF

- **WHEN** 前端通过 `/api/ppt-proxy/8765/index.html` 访问 PPT 预览
- **THEN** daemon 验证端口 8765 属于活跃 pptPreviewBridge session；不属于则返回 403；不能作为通用 localhost 代理

#### Scenario: 卸载时停止进程

- **WHEN** 用户关闭 PPT 预览 modal 或切换房间
- **THEN** 对应的 `officecli watch` 进程停止；端口释放

---

### Requirement: 统一预览矩阵与 fallback 状态

The system SHALL derive preview behavior from `artifact.kind`, `artifact.type`, and file extension, handling all content types with consistent loading, error, too-large, and unsupported states.

**完整预览矩阵（参考 Multica `preview.ts`）：**

| 类型 | 渲染方式 | too-large 阈值 | fallback |
|------|---------|--------------|---------|
| `web_page`, `web_app` | sandbox iframe（`allow-scripts`，无 same-origin）| 500KB | Download |
| `presentation`（HTML slides）| HTML slides viewer | 500KB | Download |
| `presentation_pptx` | officecli watch iframe | — | Download + install prompt |
| `document`（Markdown）| sanitized Markdown renderer | 200KB | raw text |
| `source_code` | Monaco syntax highlight（只读）| 1MB | raw text |
| image（`.png/.jpg/.gif/.webp/.svg`）| `<img>` | — | broken icon fallback |
| PDF（`.pdf`）| `<iframe>` PDF viewer | 10MB | Download |
| audio（`.mp3/.wav/.ogg`）| `<audio controls>` | — | Download |
| video（`.mp4/.webm`）| `<video controls>` | — | Download |
| `generic_file` / text | raw text viewer | 500KB | Download |
| unsupported | "不支持预览此格式" + Download | — | — |

**边界状态（所有类型统一处理）：**
- `loading`：加载指示器
- `error` / `failed`：显示错误信息 + Retry + Download
- `too-large`：显示文件大小 + Download（不崩溃）
- `unsupported`：显示格式名 + Download
- `open-in-new-tab`：所有类型均提供（HTML 在独立 tab 以完整页面打开）

#### Scenario: 超大文件降级

- **WHEN** 用户打开一个 800KB web_page artifact
- **THEN** PreviewCard 显示"文件较大，无法内联预览"+ Download 按钮；不崩溃不卡死

#### Scenario: 不支持类型降级

- **WHEN** 用户打开 `.xlsx` 文件 artifact
- **THEN** ArtifactCard 显示"不支持预览此格式（.xlsx）"+ Download 按钮

#### Scenario: HTML 预览严格沙箱

- **WHEN** 用户展开 web_page artifact
- **THEN** iframe `sandbox="allow-scripts"`（无 `allow-same-origin`）；预览页 JS 无法访问 daemon API

---

### Requirement: 文档/Slide 选区到聊天的 token 映射

The system SHALL map Document paragraph selection and Presentation slide selection to line-range tokens for context injection.

**Markdown 文档段落选择：** 用户在 DocumentCard 或 Markdown preview 中选中一段文字 → 系统映射到 `artifact_files.new_content` 中对应的行范围 → 插入 `@artifact:<id>#L{start}-L{end}` pill。

**HTML Slides slide 选择：** 用户在全屏 Presentation 模式点击"引用此页" → 插入 `@artifact:<id>#slide={N}` pill；daemon context-ref resolver 将 `#slide=N` 解析为 HTML 中第 N 个 slide 的源码行范围（通过 `<!-- slide-N -->` 注释边界检测），注入 `<context-ref type="artifact" id="..." slide="N">` 块。

**PPTX slide 选择：** 用户在 officecli preview 中按当前页点击"引用此页" → 插入 `@artifact:<id>#slide={N}` pill；daemon 使用 reference-backed 的 officecli 命令提取第 N 张 slide 文本，优先 `officecli view "$FILE" text --start N --end N`，或 `officecli get "$FILE" "/slide[N]"`；实现者 MUST 通过 `officecli help` 确认实际可用命令并编写 mock 测试。

UI pill 显示友好名称：`@report.md#L10-L25` 或 `@deck.pptx#slide=3`。

#### Scenario: Markdown 段落选区引用

- **WHEN** 用户在 DocumentCard 中选中第 3-5 段，点击"Reference in Chat"
- **THEN** InputBox 出现 `@report.md#L8-L15` pill（行范围由段落边界计算）；发送时 Agent 收到该段落内容的 context-ref block

#### Scenario: Slide 引用

- **WHEN** 用户在 HTML slides 全屏模式查看第 3 页，点击"引用此页"
- **THEN** InputBox 出现 `@deck.html#slide=3` pill；发送时 Agent 收到第 3 张 slide 的源码内容

