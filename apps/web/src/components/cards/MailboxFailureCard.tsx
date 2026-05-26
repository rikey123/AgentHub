import { Alert, Button } from "@heroui/react";

interface MailboxFailureCardProps {
  reason: string;
  attemptCount?: number;
  onDebug?: () => void;
}

export function MailboxFailureCard({ reason, attemptCount, onDebug }: MailboxFailureCardProps) {
  return (
    <Alert color="danger">
      <Alert.Content>
        <Alert.Title>Mailbox delivery failed</Alert.Title>
        <Alert.Description>
          {reason}
          {attemptCount ? ` · ${attemptCount} attempt${attemptCount === 1 ? "" : "s"}` : ""}
        </Alert.Description>
        {onDebug ? (
          <div className="mt-2">
            <Button size="sm" variant="ghost" onPress={onDebug}>Open debug</Button>
          </div>
        ) : null}
      </Alert.Content>
    </Alert>
  );
}
