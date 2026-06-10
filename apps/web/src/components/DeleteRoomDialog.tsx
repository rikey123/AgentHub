import { useState } from "react";
import { Button, Modal } from "@heroui/react";
import type { RoomViewModel } from "../types.ts";

interface DeleteRoomDialogProps {
  room?: RoomViewModel | undefined;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (roomId: string) => Promise<void> | void;
}

export function DeleteRoomDialog({ room, isOpen, onOpenChange, onConfirm }: DeleteRoomDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const handleConfirm = async () => {
    if (room === undefined) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await onConfirm(room.id);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="sm" className="items-center justify-center p-4">
        <Modal.Dialog className="w-[min(92vw,420px)] p-0">
          <Modal.CloseTrigger />
          <Modal.Header className="border-b border-border px-5 py-4">
            <Modal.Heading>删除房间？</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="px-5 py-4">
            <p className="text-sm">
              确定要删除
              <span className="font-semibold">「{room?.title ?? ""}」</span>
              吗？此操作会将房间从列表中移除。
            </p>
            {error ? <p className="mt-2 text-xs text-danger" role="alert">{error}</p> : null}
          </Modal.Body>
          <Modal.Footer className="border-t border-border px-5 py-4">
            <Button slot="close" variant="tertiary" isDisabled={submitting}>取消</Button>
            <Button
              variant="danger"
              isPending={submitting}
              isDisabled={submitting || room === undefined}
              onPress={() => void handleConfirm()}
            >
              删除
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
