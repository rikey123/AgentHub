# v1-roadmap (V1.0 delta)

## REMOVED Requirements

### Requirement: V1.0 Squad / Team 模式占位

**Reason**：V1.0 已实现 Squad Mode（squad-mode capability）和 Team Mode（team-mode capability）；占位不再需要。

**Migration**：`POST /rooms { mode: "squad" }` 和 `POST /rooms { mode: "team" }` 现在正常创建房间，不再返回 501。
