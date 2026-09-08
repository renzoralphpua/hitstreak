"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Alert } from "@/lib/alerts";
import { formatMoney, formatPercent } from "@/lib/format";
import { Button, CardRow } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { deleteAlertAction } from "./actions";

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const line = (a: Alert) => `${a.direction === "above" ? "Rises above" : "Drops below"} ${formatMoney(a.threshold)}`;

function Group({ title, alerts, onDelete, busyId }: { title: string; alerts: Alert[]; onDelete: (a: Alert) => void; busyId: number | null }) {
  if (alerts.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{title}</span>
      <ul className="flex flex-col gap-2">
        {alerts.map((a) => {
          const triggered = !a.armed;
          const detail = triggered
            ? `${line(a)} · emailed ${a.lastFiredAt ? day.format(new Date(a.lastFiredAt)) : "—"}`
            : line(a);
          return (
            <li key={a.id}>
              <CardRow
                tone={triggered ? "inverted" : "default"}
                name={a.cardName}
                subtitle={`${[a.setName, a.number, a.subtype].filter(Boolean).join(" · ")} — ${detail}`}
                imageUrl={a.imageUrl}
                right={
                  <>
                    <span className="text-sm font-semibold">{formatMoney(a.market)}</span>
                    {triggered ? (
                      <span className="text-[11px] opacity-70">
                        re-arms {a.direction === "above" ? "below" : "above"} {formatMoney(a.threshold)}
                      </span>
                    ) : a.change30d ? (
                      // Same up/down tone as the mockup's watching rows; a 0 change stays dim.
                      <span
                        className={cn(
                          "text-[11px]",
                          a.change30d.amount > 0 && "text-gain",
                          a.change30d.amount < 0 && "text-accent",
                          a.change30d.amount === 0 && "text-dim"
                        )}
                      >
                        {formatPercent(a.change30d.ratio)} · 30D
                      </span>
                    ) : (
                      <span className="text-[11px] text-dim">no 30D history</span>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-1"
                      disabled={busyId === a.id}
                      aria-label={`Delete alert for ${a.cardName}`}
                      onClick={() => onDelete(a)}
                    >
                      Delete
                    </Button>
                  </>
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function AlertList({ alerts }: { alerts: Alert[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function remove(a: Alert) {
    if (!window.confirm(`Delete the ${line(a).toLowerCase()} alert for ${a.cardName}?`)) return;
    setBusyId(a.id);
    setError(null);
    try {
      const res = await deleteAlertAction(a.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Group title="Triggered" alerts={alerts.filter((a) => !a.armed)} onDelete={remove} busyId={busyId} />
      <Group title="Watching" alerts={alerts.filter((a) => a.armed)} onDelete={remove} busyId={busyId} />
      {error && (
        <p role="alert" className="text-[13px] text-accent">
          {error}
        </p>
      )}
    </div>
  );
}
