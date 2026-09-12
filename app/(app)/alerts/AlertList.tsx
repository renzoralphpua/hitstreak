"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Alert } from "@/lib/alerts";
import { formatMoney, formatPercent } from "@/lib/format";
import { Button, CardRow } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { deleteAlertAction } from "./actions";
import type { Display } from "@/lib/currency";
import { useDisplay } from "@/components/currency/CurrencyProvider";

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
// Takes the display rather than reading it: this is module scope, where a hook cannot go.
const line = (a: Alert, display: Display) =>
  `${a.direction === "above" ? "Rises above" : "Drops below"} ${formatMoney(a.threshold, { display })}`;

function Group({ title, alerts, onDelete, busyId }: { title: string; alerts: Alert[]; onDelete: (a: Alert) => void; busyId: number | null }) {
  const display = useDisplay();
  if (alerts.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-caption font-semibold uppercase tracking-[0.06em] text-muted">{title}</span>
      <ul className="flex flex-col gap-2">
        {alerts.map((a) => {
          const triggered = !a.armed;
          const detail = triggered
            ? `${line(a, display)} · emailed ${a.lastFiredAt ? day.format(new Date(a.lastFiredAt)) : "—"}`
            : line(a, display);
          return (
            <li key={a.id}>
              <CardRow
                tone={triggered ? "inverted" : "default"}
                name={a.cardName}
                subtitle={`${[a.setName, a.number, a.subtype].filter(Boolean).join(" · ")} — ${detail}`}
                imageUrl={a.imageUrl}
                right={
                  <>
                    <span className="text-base font-semibold">{formatMoney(a.market, { display })}</span>
                    {triggered ? (
                      <span className="text-micro opacity-70">
                        re-arms {a.direction === "above" ? "below" : "above"} {formatMoney(a.threshold, { display })}
                      </span>
                    ) : a.change30d ? (
                      // Same up/down tone as the mockup's watching rows; a 0 change stays dim.
                      <span
                        className={cn(
                          "text-micro",
                          a.change30d.amount > 0 && "text-gain",
                          a.change30d.amount < 0 && "text-accent",
                          a.change30d.amount === 0 && "text-dim"
                        )}
                      >
                        {formatPercent(a.change30d.ratio)} · 30D
                      </span>
                    ) : (
                      <span className="text-micro text-dim">no 30D history</span>
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
  const display = useDisplay();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function remove(a: Alert) {
    if (!window.confirm(`Delete the ${line(a, display).toLowerCase()} alert for ${a.cardName}?`)) return;
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
        <p role="alert" className="text-base text-accent">
          {error}
        </p>
      )}
    </div>
  );
}
