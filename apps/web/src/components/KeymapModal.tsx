import { Modal, Kbd } from "@heroui/react";

interface KeymapModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

// Windows 下 ⌘ 对应 Ctrl；其余原样显示
const KEY_LABEL: Record<string, string> = { "⌘": "CTRL" };

// 全部大写显示；单键原样大写，组合键用 + 连接（如 CTRL+K）
function formatKeys(keys: string[]): string {
  return keys.map((k) => (KEY_LABEL[k] ?? k).toUpperCase()).join("+");
}

const groups: Array<{ title: string; rows: Array<[string[], string]> }> = [
  {
    title: "全局",
    rows: [
      [["⌘", "K"], "命令面板"],
      [["?"], "显示此帮助"],
      [["g", "r"], "聚焦 rooms 面板"],
      [["g", "d"], "聚焦 DEBUG 面板"]
    ]
  },
  {
    title: "聊天",
    rows: [
      [["j"], "下一条消息"],
      [["k"], "上一条消息"],
      [["q"], "引用所选"],
      [["r"], "打开运行详情"],
      [["p"], "置顶消息"],
      [["d"], "删除消息"]
    ]
  },
  {
    title: "撰写",
    rows: [
      [["Enter"], "发送"],
      [["Shift", "Enter"], "换行"],
      [["⌘", "Enter"], "发送"],
      [["@"], "提及 agent"],
      [["Esc"], "关闭弹窗"]
    ]
  }
];

export function KeymapModal({ isOpen, onOpenChange }: KeymapModalProps) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="lg">
        <Modal.Dialog className="!max-w-2xl">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading className="text-lg font-bold">键盘快捷键</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-3">
              {groups.map((g) => (
                <section key={g.title}>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</h3>
                  <ul className="flex flex-col gap-2.5 text-sm">
                    {g.rows.map(([keys, label], rowIdx) => (
                      <li key={`${g.title}-${rowIdx}-${label}`} className="flex items-center justify-between gap-3">
                        <span className="whitespace-nowrap text-foreground">{label}</span>
                        <Kbd className="shrink-0 whitespace-nowrap">{formatKeys(keys)}</Kbd>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
