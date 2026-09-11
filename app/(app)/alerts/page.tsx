import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { parseRouteId } from "@/lib/route-id";
import { listAlerts, getAlertCard } from "@/lib/alerts";
import { SectionHeading, Panel, EmptyState } from "@/components/ui";
import AlertList from "./AlertList";
import NewAlertForm from "./NewAlertForm";

export const metadata = { title: "Alerts — Hitstreak" };
// Per-user rows valued from latest_prices: never prerender or cache across users.
export const dynamic = "force-dynamic";

export default async function AlertsPage({ searchParams }: PageProps<"/alerts">) {
  const { printing } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/sign-in"); // the layout already gates; this is for the user id
  const userId = session.user.id;
  const printingId = typeof printing === "string" ? parseRouteId(printing) : null;
  const [alerts, preselected] = await Promise.all([
    listAlerts(userId),
    printingId == null ? null : getAlertCard(userId, printingId),
  ]);
  const watching = alerts.filter((a) => a.armed).length;

  return (
    <div className="mx-auto grid w-full max-w-read gap-10 md:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-4">
        <SectionHeading
          as="h1"
          title="Price alerts"
          caption={`${watching} watching · checked nightly after the 21:00 UTC price sync`}
        />
        {alerts.length === 0 ? (
          <EmptyState
            title="No alerts yet"
            body="Use New alert to pick a card and set a price line — you get one email when it crosses."
          />
        ) : (
          <AlertList alerts={alerts} />
        )}
      </div>
      <div className="flex flex-col gap-4">
        <Panel>
          {/* Keyed so arriving with a different `?printing=` while already here restarts the form on
              that printing — its state is seeded from props only on mount. */}
          <NewAlertForm key={preselected?.printingId ?? "search"} preselected={preselected} />
        </Panel>
        <Panel className="flex flex-col gap-2 text-[13px] text-muted">
          <span className="font-semibold text-ink">How alerts work</span>
          <p>
            Prices sync once a day. Each alert emails you once when it crosses, then re-arms after the price
            crosses back — no repeat emails while it stays past the line.
          </p>
          <p>Delivered to your account email.</p>
        </Panel>
      </div>
    </div>
  );
}
