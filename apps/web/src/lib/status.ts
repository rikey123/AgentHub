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
    case "done":
      return "success";
    case "failed":
    case "blocked":
      return "danger";
    case "cancelled":
      return "default";
    case "running":
    case "waiting_approval":
      return "warning";
    case "review":
      return "accent";
    case "queued":
    case "todo":
    default:
      return "default";
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
