export type ChipColor = "default" | "accent" | "success" | "warning" | "danger";

export function runStatusColor(status: string): ChipColor {
  switch (status) {
    case "running":
      return "accent";
    case "waiting_permission":
      return "warning";
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "cancelled":
    case "cancelling":
      return "default";
    default:
      return "default";
  }
}

export function runStatusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "starting":
      return "启动中";
    case "running":
      return "运行中";
    case "waiting_permission":
      return "等待许可";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "cancelling":
      return "取消中";
    default:
      return status;
  }
}

export function permissionStatusColor(status: string): ChipColor {
  switch (status) {
    case "allowed":
      return "success";
    case "denied":
      return "danger";
    case "expired":
      return "default";
    case "pending":
    default:
      return "warning";
  }
}

export function permissionStatusLabel(status: string): string {
  switch (status) {
    case "allowed":
      return "已允许";
    case "denied":
      return "已拒绝";
    case "expired":
      return "已过期";
    case "pending":
      return "待处理";
    default:
      return status;
  }
}

export function pendingTurnColor(status: string | undefined): ChipColor {
  switch (status) {
    case "queued":
      return "warning";
    case "scheduled":
      return "accent";
    case "consumed":
      return "success";
    case "cancelled":
      return "default";
    default:
      return "default";
  }
}

export function presenceColor(presence: string): ChipColor {
  switch (presence) {
    case "active":
    case "working":
      return "success";
    case "knocking":
    case "waiting_approval":
      return "warning";
    case "blocked":
      return "danger";
    case "observing":
      return "accent";
    case "offline":
    default:
      return "default";
  }
}

export function contextStatusColor(status: string): ChipColor {
  switch (status) {
    case "confirmed":
      return "success";
    case "deprecated":
      return "default";
    case "disputed":
      return "danger";
    case "draft":
    default:
      return "warning";
  }
}

export function taskStatusColor(status: string): ChipColor {
  switch (status) {
    case "completed":
    case "done":
      return "success";
    case "failed":
    case "blocked":
      return "danger";
    case "cancelled":
      return "default";
    case "in_progress":
    case "running":
    case "waiting_approval":
      return "warning";
    case "review":
      return "accent";
    case "pending":
    case "queued":
    case "todo":
    default:
      return "default";
  }
}

export function taskStatusLabel(status: string): string {
  switch (status) {
    case "pending":
    case "queued":
    case "todo":
      return "待处理";
    case "in_progress":
    case "running":
      return "进行中";
    case "waiting_approval":
      return "等待许可";
    case "review":
      return "待评审";
    case "blocked":
      return "阻塞";
    case "completed":
    case "done":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

export function interventionPriorityColor(p: string): ChipColor {
  switch (p) {
    case "high": return "danger";
    case "medium": return "warning";
    case "low":
    default: return "default";
  }
}

export function connectionColor(status: string): ChipColor {
  switch (status) {
    case "connected": return "success";
    case "connecting":
    case "reconnecting": return "warning";
    case "offline": return "danger";
    default: return "default";
  }
}
