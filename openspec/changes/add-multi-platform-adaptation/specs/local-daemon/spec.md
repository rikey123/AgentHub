## ADDED Requirements

### Requirement: 移动端 JSON 增量事件拉取端点

daemon SHALL 提供纯 JSON 的按 seq 拉取端点（`GET /sync/events?sinceSeq=N&view=mobile`），返回自 `sinceSeq` 之后的 durable events，供不具备稳定 `EventSource` 的移动端补齐使用。该端点 SHALL 受 token 鉴权、经 `SecretRedactor` 脱敏，并复用既有 cursor/seq 语义。现有 SSE 端点（`/event?cursor=N&view=`）SHALL 保留作为 Web/Desktop 的主通道。

**Reference:** 现有 SSE 重放见 `packages/daemon/src/index.ts` 的 `replayDurableSinceSeq`（约 2474-2475 行）；普通 JSON 事件出口目前仅 admin 受限的 `/debug/events`，不可复用，故新增本端点。

#### Scenario: 移动端按 seq 拉取增量事件

- **WHEN** 移动端以 `sinceSeq=N` 请求 `/sync/events`
- **THEN** 返回 seq 大于 N 的 durable events（JSON），移动端据此补齐，无需 EventSource

#### Scenario: 拉取端点受鉴权与脱敏约束

- **WHEN** 未带有效 token 的请求访问 `/sync/events`
- **THEN** 被拒（401）；返回内容经 SecretRedactor 脱敏，无密钥/绝对路径明文

### Requirement: 移动端轻量视图与快照

daemon SHALL 提供面向移动端的轻量视图/快照（如 `view=mobile` 过滤或 `GET /sync/snapshot?view=mobile`），仅返回移动端首屏所需的轻量字段，不返回完整 detail 流，以降低移动端首屏负载与流量。

#### Scenario: 移动端首屏只拉轻量字段

- **WHEN** 移动端请求 `view=mobile` 的快照
- **THEN** 仅返回轻量字段集，不含完整 detail 流

### Requirement: 移动端产物预览安全访问

daemon SHALL 允许移动端只读预览产物，访问 MUST 受 token 鉴权、经 `SecretRedactor` 脱敏，并复用现有 `file://`/`data:` 安全校验（MIME/尺寸限制、SVG 净化、绝对路径不外泄）。

#### Scenario: 移动端预览不泄露敏感信息

- **WHEN** 移动端预览某产物文件内容
- **THEN** 内容经脱敏与路径安全校验，不泄露绝对路径或密钥

### Requirement: 局域网绑定支持多端接入

daemon SHALL 支持绑定到局域网 IP（如 `192.168.x.x`）以供同一局域网内的移动端接入，而不仅 `127.0.0.1`。绑定到任何非 loopback host 时，daemon MUST 强制配置 `auth.token` 且 `server.remote.enabled = true`，否则拒绝启动（此约束已由现有守卫实现，见 security 能力，本能力确认不放松）。daemon MUST NOT 内建跨网络/VPN/公网穿透能力。

#### Scenario: 绑定局域网 IP 供移动端连接

- **WHEN** 用户将 daemon `bind` 配为局域网 IP 并配置 token + remote.enabled
- **THEN** daemon 启动并可被同一局域网内携带 token 的移动端连接

#### Scenario: 局域网绑定缺 token 拒绝启动

- **WHEN** 用户将 daemon 绑定到非 loopback host 但未配置 token 或未开启 remote
- **THEN** daemon 拒绝启动并提示需配置 token 且开启 remote
