## ADDED Requirements

### Requirement: 多端非 loopback 绑定强制 token

为支持移动端经局域网接入，daemon 绑定到任何非 loopback host（含局域网 `192.168.x.x`，不限于 `0.0.0.0`）时 MUST 强制配置 `auth.token` 且 `server.remote.enabled = true`，否则拒绝启动。该 token 是既有 Bearer token 机制的延续，作为局域网暴露下的"连接口令"，MUST NOT 被解读为登录或新增鉴权体系。

**Reference:** 守卫已存在于 `packages/security`/`packages/daemon`：`config.ts:206` 仅对 `0.0.0.0` 触发；`index.ts:216` 对**任意非 loopback host** 触发，强制 `token` + `allowRemote=true`。本能力在需求层面确认此约束覆盖局域网 IP 场景且不放松。

#### Scenario: 局域网绑定缺 token 拒绝启动

- **WHEN** daemon 配置 `bind` 为非 loopback host（如 `192.168.1.10`）但未配置 token 或未开启 remote
- **THEN** daemon 拒绝启动

#### Scenario: token 作为连接口令而非登录

- **WHEN** 移动端携带由主端签发的 token 连接局域网 daemon
- **THEN** 经既有 Bearer token 校验通过，无任何登录/账号流程

### Requirement: 原生客户端与 Electron 的 Origin 鉴权区分

daemon 鉴权 MUST 保持 Origin/Host 前置于 Bearer 的既有顺序。移动 App / 原生 HTTP client 请求通常无 Origin，SHALL 走 Bearer 分支并免 CSRF。Electron renderer 本质 browser-like、请求会带 Origin，因此 MUST 同源加载（daemon-served 资源）或将其 origin 列入 `allowedOrigins`，MUST NOT 依赖"无 Origin 免 CSRF"。带不被允许 Origin 的请求即使携带合法 token 也 MUST 被拒（403）。

**Reference:** `packages/security/src/index.ts` 的 `authenticateBrowserRequest`（约 237-243 行）先校验 Origin/Host 再处理 Bearer。

#### Scenario: 原生无 Origin 请求走 Bearer

- **WHEN** 移动 App 发出无 Origin、携带合法 token 的请求
- **THEN** 经 Bearer 分支鉴权通过，免 CSRF

#### Scenario: 非法 Origin 即使有 token 也被拒

- **WHEN** 客户端发出带不被允许 Origin 的请求，即便携带合法 token
- **THEN** 被 403 拒绝

#### Scenario: Electron 同源消除 Origin 问题

- **WHEN** Electron renderer 经 `loadURL(http://127.0.0.1:<port>/)` 同源加载并发请求
- **THEN** Origin 与 daemon 同源，通过校验

### Requirement: token 签发与吊销分发给移动端

daemon SHALL 支持在已认证的 Web/Desktop 端签发供移动端使用的 token（连接配置），并 SHALL 支持在任一已认证端列出与吊销 token。token 被吊销后，移动端后续请求 MUST 失效（401）。

#### Scenario: 吊销后移动端失效

- **WHEN** 用户在主端吊销某移动端 token
- **THEN** 该移动端后续请求返回 401
