# security (V0.5 delta)

## ADDED Requirements

### Requirement: 文件附件上传安全（multipart）

The system SHALL enforce security controls on `POST /attachments` (multipart/form-data) introduced in V0.5 for drag-drop attachment support.

**CSRF / Origin 豁免**：

- `POST /attachments` 是 mutating route，**不豁免** CSRF / Origin 校验；
- 浏览器 drag-drop 触发的 `fetch()` 请求必须携带 CSRF token（`X-Agenthub-CSRF` header）+ session cookie，与其他 mutating route 一致；
- 原生 `<input type="file">` 表单提交不支持自定义 header，**不允许**；UI 必须用 `fetch()` + FormData。

**MIME 白名单**：

- 允许：`text/*` / `application/json` / `application/pdf` / `image/*` / `application/zip` / `application/octet-stream`；
- 拒绝：`text/html` / `application/javascript` / `application/x-sh` / `application/x-executable` 等可执行类型；
- 未知 MIME → 拒绝（fail-closed）；
- 检测方式：先读 Content-Type header，再用 magic bytes 二次校验（防 MIME sniffing）。

**大小限制**：

- 单文件 ≤ 50 MB；
- 单次请求 ≤ 50 MB（不允许多文件合并超限）；
- 超限 → 413 + `{ error: "attachment_too_large", maxBytes: 52428800 }`。

**存储路径安全**：

- 存储路径：`<workspace>/.agenthub/attachments/<yyyy>/<mm>/<fileId>`；
- `fileId` 由 daemon 生成（UUID），**不**使用用户提供的文件名作为路径组成部分；
- 用户提供的原始文件名仅存 `attachments` 表 `original_name` 列（展示用），不参与路径构造；
- 路径 canonicalize：存储前调 `resolveWorkspacePath` 确认落在 workspace 管理根内。

**SVG 净化**：

- `image/svg+xml` 类型文件在存储前调 `sanitizeSvg()`（MVP §19.13.3 已实现），移除 `<script>` / `<foreignObject>` / `on*` handlers；
- 净化失败 → 拒绝上传（不存储原始 SVG）。

**清理策略**：

- 附件文件在关联 message 被软删除后 **不立即删除**（保留 30 天，与 artifact revert 保留期一致）；
- 30 天后由 GC 任务（与 worktree GC 同一后台任务）清理；
- 孤立附件（无关联 message，如上传后用户未发送）在 24 小时后清理。

#### Scenario: 合法 PDF 上传

- **WHEN** 用户 drag-drop 一个 200 KB PDF，UI 用 fetch() + FormData + CSRF token 调 POST /attachments
- **THEN** daemon 校验 CSRF + Origin + MIME（application/pdf）+ 大小 → 通过
- **AND** 存储到 `<workspace>/.agenthub/attachments/<yyyy>/<mm>/<uuid>`
- **AND** 返回 `{ fileId: "<uuid>", originalName: "report.pdf", sizeBytes: 204800, sha256: "..." }`

#### Scenario: 可执行文件被拒

- **WHEN** 用户上传 `malware.sh`（Content-Type: application/x-sh）
- **THEN** daemon 返回 415 + `{ error: "attachment_mime_not_allowed", mime: "application/x-sh" }`
- **AND** 文件不写磁盘

#### Scenario: SVG 净化

- **WHEN** 用户上传含 `<script>alert(1)</script>` 的 SVG
- **THEN** daemon 调 sanitizeSvg() 移除 script 标签后存储净化版本
- **AND** 返回 fileId（净化后的文件）

#### Scenario: 超大文件被拒

- **WHEN** 用户上传 60 MB 文件
- **THEN** daemon 返回 413 + `{ error: "attachment_too_large", maxBytes: 52428800 }`

#### Scenario: 路径不出 workspace

- **WHEN** daemon 构造存储路径
- **THEN** 路径 = `<workspace>/.agenthub/attachments/<yyyy>/<mm>/<uuid>`（fileId 是 UUID，不含用户文件名）
- **AND** resolveWorkspacePath 校验路径在管理根内（防 path traversal）
