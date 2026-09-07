import { SectionHeading, Panel } from "@/components/ui";

export const metadata = { title: "Binder — Hitstreak" };

export default function PortfoliosPage() {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeading title="Binder" as="h1" />
      <Panel>
        <p className="text-[13px] text-muted">Your portfolios arrive in Phase 2b.</p>
      </Panel>
    </div>
  );
}
