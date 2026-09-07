import { SectionHeading, EmptyState } from "@/components/ui";

export const metadata = { title: "Alerts — Hitstreak" };

export default function AlertsPage() {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeading as="h1" title="Alerts" />
      <EmptyState title="Coming in Phase 3" body="Email price alerts arrive with price history charts." />
    </div>
  );
}
