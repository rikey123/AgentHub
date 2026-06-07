export function contextStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "待确认";
    case "confirmed":
      return "已确认";
    case "deprecated":
      return "已失效";
    case "disputed":
      return "有争议";
    default:
      return status;
  }
}

export function contextScopeLabel(scope: string): string {
  switch (scope) {
    case "conversation":
      return "当前对话";
    case "workspace":
      return "工作区";
    case "room":
      return "Room";
    case "run":
      return "Run";
    case "task":
      return "任务";
    case "message":
      return "消息";
    case "global":
      return "全局";
    default:
      return scope;
  }
}
