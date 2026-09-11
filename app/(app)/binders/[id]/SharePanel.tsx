"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ShareLink } from "@/lib/share";
import { Button, Panel } from "@/components/ui";
import { enableShareAction, regenerateShareAction, disableShareAction } from "../actions";

// Local alias (not imported from the actions module): the three actions return ActionResult<ShareLink>
// for enable/regenerate and ActionResult<void> for disable, so `run` must be generic over the payload.
type Result<T> = { ok: true; data?: T } | { ok: false; error: string };

/** Share on/off for one binder. The link is shown as a path; "Copy" resolves it against the
 *  current origin at click time so preview deploys and localhost copy the right host. */
export default function SharePanel({ portfolioId, link }: { portfolioId: number; link: ShareLink | null }) {
  const router = useRouter();
  const [current, setCurrent] = useState<ShareLink | null>(link);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run<T>(call: () => Promise<Result<T>>, after?: (data: T | undefined) => void) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await call();
      if (!res.ok) { setError(res.error); return; }
      after?.(res.data);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const path = current ? `/s/${current.token}` : null;

  async function copy() {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
      setNotice("Link copied.");
    } catch {
      setError("Couldn't copy — select the link and copy it yourself.");
    }
  }

  return (
    <Panel className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-ink">Share</span>
        <span className="text-caption text-dim">{current?.enabled ? "Anyone with the link can view" : "Off"}</span>
      </div>
      {current?.enabled ? (
        <>
          <code className="num truncate rounded-tile border border-hairline bg-ground px-3 py-2 text-caption text-ink" aria-label="Share link">{path}</code>
          <p className="text-caption text-dim">Viewers see the cards and their market value — never what you paid.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={copy} disabled={busy}>Copy link</Button>
            <Button variant="secondary" size="sm" disabled={busy}
              onClick={() => { if (window.confirm("Replace the link? The old one will stop working.")) void run(() => regenerateShareAction(portfolioId), (d) => setCurrent(d ?? null)); }}>
              New link
            </Button>
            <Button variant="secondary" size="sm" disabled={busy}
              onClick={() => run(() => disableShareAction(portfolioId), () => setCurrent((c) => (c ? { ...c, enabled: false } : c)))}>
              Turn off
            </Button>
          </div>
        </>
      ) : (
        <Button variant="secondary" className="self-start" disabled={busy} onClick={() => run(() => enableShareAction(portfolioId), (d) => setCurrent(d ?? null))}>
          Share this binder
        </Button>
      )}
      {notice && <p className="text-base text-gain">{notice}</p>}
      {error && <p role="alert" className="text-base text-accent">{error}</p>}
    </Panel>
  );
}
