import { Modal, Kbd } from "@heroui/react";

interface KeymapModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const groups: Array<{ title: string; rows: Array<[string[], string]> }> = [
  {
    title: "Global",
    rows: [
      [["⌘", "K"], "Command palette"],
      [["?"], "Show this help"],
      [["g", "r"], "Focus rooms"],
      [["g", "d"], "Focus debug panel"]
    ]
  },
  {
    title: "Chat",
    rows: [
      [["j"], "Next message"],
      [["k"], "Previous message"],
      [["q"], "Quote selected"],
      [["r"], "Open run"],
      [["p"], "Pin message"],
      [["d"], "Delete message"]
    ]
  },
  {
    title: "Compose",
    rows: [
      [["Enter"], "Send"],
      [["Shift", "Enter"], "Newline"],
      [["⌘", "Enter"], "Send"],
      [["@"], "Mention agent"],
      [["Esc"], "Close popovers"]
    ]
  }
];

export function KeymapModal({ isOpen, onOpenChange }: KeymapModalProps) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="md">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Keyboard shortcuts</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {groups.map((g) => (
                <section key={g.title}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</h3>
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {g.rows.map(([keys, label], rowIdx) => (
                      <li key={`${g.title}-${rowIdx}-${label}`} className="flex items-center gap-2">
                        <span className="flex-1">{label}</span>
                        <span className="flex gap-1">
                          {keys.map((k, i) => <Kbd key={i}>{k}</Kbd>)}
                        </span>
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
