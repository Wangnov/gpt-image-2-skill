import { useEffect, useState, type ReactNode } from "react";
import { hasConfiguredHttpRuntime } from "@/lib/api/http/client";
import { getSessionStatus, login } from "@/lib/api/http/session";
import { Button } from "@/components/ui/button";

type GateState =
  | { phase: "checking" }
  | { phase: "authorized" }
  | { phase: "needs-token" };

/**
 * Blocks the app behind the server's access token when the HTTP runtime
 * (Docker Web / self-hosted) is protected by GPT_IMAGE_2_WEB_TOKEN. In the
 * Tauri and static-browser runtimes there is no server token, so this renders
 * children immediately. Auth rides an HttpOnly cookie, so once past the gate
 * both fetch and `<img>` requests authenticate automatically.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>(() =>
    hasConfiguredHttpRuntime() ? { phase: "checking" } : { phase: "authorized" },
  );
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state.phase !== "checking") return;
    let cancelled = false;
    void getSessionStatus().then((status) => {
      if (cancelled) return;
      setState({
        phase:
          !status.authRequired || status.authorized
            ? "authorized"
            : "needs-token",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [state.phase]);

  if (state.phase === "authorized") return <>{children}</>;

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    const ok = await login(token.trim()).catch(() => false);
    setSubmitting(false);
    if (ok) {
      setToken("");
      setState({ phase: "authorized" });
    } else {
      setError("访问令牌不正确。");
    }
  };

  return (
    <div className="desktop flex h-full w-full items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-[360px] rounded-2xl border border-[color:var(--w-10)] bg-[color:var(--w-04)] p-6 shadow-xl"
      >
        <h1 className="t-h2 mb-1 text-foreground">需要访问令牌</h1>
        <p className="mb-4 text-[13px] text-muted">
          这个服务端设置了 <code>GPT_IMAGE_2_WEB_TOKEN</code>
          。输入访问令牌以继续。
        </p>
        <input
          type="password"
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="访问令牌"
          aria-label="访问令牌"
          className="mb-3 w-full rounded-lg border border-[color:var(--w-10)] bg-[color:var(--w-02)] px-3 py-2 text-[14px] text-foreground outline-none focus:border-[color:var(--accent-40)]"
        />
        {error && <p className="mb-3 text-[12.5px] text-red-400">{error}</p>}
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={!token.trim() || submitting}
          className="w-full"
        >
          {submitting ? "验证中…" : "进入"}
        </Button>
      </form>
    </div>
  );
}
