import { Modal, Button } from "@heroui/react";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface MobilePairingModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  csrfFetch: typeof fetch;
}

type ConnectionConfig = {
  readonly version?: number;
  readonly url: string;
  readonly host: string;
  readonly port: number | null;
  readonly token: string;
  readonly network?: "lan" | "loopback";
  readonly source?: "primary-listener" | "mobile-bridge" | "request-host" | "unavailable";
  readonly reachableFromMobile?: boolean;
  readonly issue?: string;
  readonly endpoint?: {
    readonly url?: string;
    readonly host?: string;
    readonly port?: number | null;
    readonly network?: string;
    readonly source?: string;
    readonly reachableFromMobile?: boolean;
    readonly issue?: string;
  };
  readonly qrPayload: string;
};

type IssueResult = { readonly connection?: ConnectionConfig };

type PairingState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; connection: ConnectionConfig; qrDataUrl: string }
  | { status: "error"; message: string };

// 永不过期：移动端验证一次后，只要不在手机上退出就无需二次验证。
async function issueMobileToken(csrfFetch: typeof fetch): Promise<ConnectionConfig> {
  const response = await csrfFetch("/auth/tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ description: "移动端验证", scopes: ["read", "write"] })
  });
  if (!response.ok) throw new Error(`签发失败（${response.status}）`);
  const payload = (await response.json()) as IssueResult;
  if (payload.connection === undefined) throw new Error("本地服务未返回连接配置");
  return payload.connection;
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function mobileReachable(connection: ConnectionConfig): boolean {
  return connection.reachableFromMobile === true || connection.endpoint?.reachableFromMobile === true || !isLoopback(connection.host);
}

export function MobilePairingModal({ isOpen, onOpenChange, csrfFetch }: MobilePairingModalProps) {
  const [state, setState] = useState<PairingState>({ status: "idle" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setState({ status: "idle" });
      setCopied(false);
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    void (async () => {
      try {
        const connection = await issueMobileToken(csrfFetch);
        const qrDataUrl = await QRCode.toDataURL(connection.qrPayload, { margin: 1, width: 240, errorCorrectionLevel: "M" });
        if (!cancelled) setState({ status: "ready", connection, qrDataUrl });
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, csrfFetch]);

  const copyIdentityCode = (code: string): void => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="lg">
        <Modal.Dialog className="!max-w-md">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading className="text-lg font-bold">移动端验证</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <p className="mb-4 text-sm text-muted">
              在手机 App 上扫描二维码，或将身份码粘贴到手动连接中。验证一次后，只要不在手机上退出，就无需再次验证。
            </p>

            {state.status === "loading" && <p className="text-sm text-muted">正在生成验证凭据…</p>}
            {state.status === "error" && <p className="text-sm text-danger">{state.message}</p>}

            {state.status === "ready" && (
              <div className="flex flex-col gap-5">
                <section className="flex flex-col items-center gap-2">
                  <h3 className="self-start text-xs font-semibold uppercase tracking-wide text-muted">扫码</h3>
                  <img src={state.qrDataUrl} alt="移动端验证二维码" className="rounded-lg border border-border bg-white p-2" width={240} height={240} />
                </section>

                <section className="rounded-lg border border-border bg-surface-muted p-3 text-xs">
                  <div className="font-semibold text-foreground">手机连接地址</div>
                  <div className="mt-1 font-mono text-foreground">{state.connection.url}</div>
                  <div className="mt-1 text-muted">
                    {mobileReachable(state.connection)
                      ? `局域网可达，来源：${state.connection.source ?? state.connection.endpoint?.source ?? "配对清单"}`
                      : "当前配置不可被手机直连"}
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">身份码</h3>
                  <textarea
                    readOnly
                    value={state.connection.qrPayload}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-field-border bg-field-background p-2.5 font-mono text-xs text-foreground"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <Button size="sm" variant="ghost" onPress={() => copyIdentityCode(state.connection.qrPayload)}>
                    {copied ? "已复制" : "复制身份码"}
                  </Button>
                </section>

                {!mobileReachable(state.connection) && (
                  <p className="rounded-lg border border-warning/40 bg-warning-soft p-2.5 text-xs text-warning-soft-foreground">
                    当前身份码没有可用的局域网地址。{state.connection.issue ?? state.connection.endpoint?.issue ?? "请确认电脑已连接局域网，并允许 AgentHub 打开移动端通讯端口。"} 手机与电脑连同一 Wi-Fi 后重新生成二维码。
                  </p>
                )}
              </div>
            )}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
