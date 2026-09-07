"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import {
  Button,
  Pill,
  Panel,
  SectionHeading,
  StatTile,
  PriceDelta,
  ProgressBar,
  TierBadge,
  ValidationList,
  SearchField,
  Input,
  CardTile,
  CardRow,
  TopNav,
  BottomTabBar,
  EmptyState,
  MoneyDisplay,
} from "@/components/ui";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { formatMoney, formatDelta } from "@/lib/format";

const PERIODS = ["7D", "30D", "90D", "1Y", "All"];

/** Shows children once in a light column and once in a forced-dark column, side by side. */
function Variants({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-panel border border-hairline bg-ground p-4">{children}</div>
      <div data-theme="dark" className="rounded-panel border border-hairline bg-ground p-4">
        {children}
      </div>
    </div>
  );
}

function Section({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl">{name}</h2>
      {children}
    </section>
  );
}

export default function Gallery() {
  if (process.env.NODE_ENV === "production") notFound();

  const [period, setPeriod] = useState("30D");
  const [query, setQuery] = useState("");

  return (
    <div className="flex flex-col gap-10 p-8 max-w-6xl mx-auto">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl">Hitstreak UI</h1>
          <p className="text-sm text-dim">Every primitive, every variant — light and dark. Name a component to change it.</p>
        </div>
        <ThemeToggle />
      </header>

      <Section name="Button">
        <Variants>
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button disabled>Disabled</Button>
            <Button href="/dev/ui">Link</Button>
            <Button href="/dev/ui" variant="secondary">
              Secondary link
            </Button>
          </div>
        </Variants>
      </Section>

      <Section name="Pill">
        <Variants>
          <div className="flex flex-wrap items-center gap-2">
            {PERIODS.map((p) => (
              <Pill key={p} selected={p === period} onClick={() => setPeriod(p)}>
                {p}
              </Pill>
            ))}
          </div>
        </Variants>
      </Section>

      <Section name="Panel">
        <Variants>
          <Panel>
            <p className="text-sm text-ink">A panel is a surface with a hairline border — cards, forms, and grouped content live here.</p>
          </Panel>
        </Variants>
      </Section>

      <Section name="SectionHeading">
        <Variants>
          <SectionHeading title="Top cards" caption="sorted by value" trailing={<span>Grid · List</span>} />
        </Variants>
      </Section>

      <Section name="StatTile">
        <Variants>
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Paid" value={formatMoney(1465)} />
            <StatTile label="Gain" value={formatDelta(908.25)} tone="gain" />
            <StatTile label="Loss" value={formatDelta(-6.8)} tone="loss" />
          </div>
        </Variants>
      </Section>

      <Section name="PriceDelta">
        <Variants>
          <div className="flex flex-col gap-2">
            <PriceDelta amount={132.1} ratio={0.028} caption="30D" />
            <PriceDelta amount={-6.8} ratio={-0.15} />
            <PriceDelta amount={0} ratio={0} />
            <PriceDelta amount={null} />
          </div>
        </Variants>
      </Section>

      <Section name="ProgressBar">
        <Variants>
          <div className="flex flex-col gap-3">
            <ProgressBar value={0.34} label="Set completion" tone="accent" />
            <ProgressBar value={1.0} label="Complete" tone="gain" />
            <ProgressBar value={0.6} label="Muted" tone="muted" />
          </div>
        </Variants>
      </Section>

      <Section name="TierBadge">
        <Variants>
          <div className="flex items-center gap-2">
            <TierBadge tier={1} />
            <TierBadge tier={2} />
            <TierBadge tier={3} />
          </div>
        </Variants>
      </Section>

      <Section name="ValidationList">
        <Variants>
          <ValidationList
            items={[
              { ok: false, text: "61 cards — a Standard deck must have exactly 60." },
              { ok: false, text: "Rare Candy ×5 — max 4 copies of a card with the same name." },
              { ok: true, text: "1 ACE SPEC (Prime Catcher)" },
              { ok: true, text: "All regulation marks legal (G, H, I)" },
            ]}
          />
        </Variants>
      </Section>

      <Section name="SearchField">
        <Variants>
          <SearchField value={query} onChange={setQuery} placeholder="Find a card…" />
        </Variants>
      </Section>

      <Section name="Input">
        <Variants>
          <div className="flex max-w-sm flex-col gap-3">
            <Input label="Email" type="email" placeholder="you@example.com" />
            <Input aria-label="Binder name" placeholder="New binder…" />
          </div>
        </Variants>
      </Section>

      <Section name="CardTile">
        <Variants>
          <div className="grid grid-cols-4 gap-3">
            <CardTile
              name="Umbreon ex"
              subtitle="Prismatic Evolutions · 161/131"
              price={formatMoney(1465)}
              quantity={1}
              imageUrl={null}
              delta={<PriceDelta amount={362.25} ratio={0.33} />}
            />
            <CardTile name="Charizard ex" subtitle="Obsidian Flames · 125/197" price={formatMoney(850)} quantity={3} imageUrl={null} />
            <CardTile name="Pidgeot ex" subtitle="Obsidian Flames · 164/197" price={formatMoney(23.35)} quantity={0} imageUrl={null} />
            <CardTile
              name="Monkey.D.Luffy"
              subtitle="Awakening of the New Era · OP05-119"
              price={formatMoney(18.2)}
              quantity={1}
              imageUrl={null}
              onClick={() => {}}
            />
          </div>
        </Variants>
      </Section>

      <Section name="CardRow">
        <Variants>
          <div className="flex flex-col gap-2">
            <CardRow
              name="Jinx, Loose Cannon"
              subtitle="Vanguard: Arcane"
              imageUrl={null}
              right={
                <>
                  <span>{formatMoney(46.5)}</span>
                  <PriceDelta amount={4.2} ratio={0.1} />
                </>
              }
            />
            <CardRow
              name="Monkey.D.Luffy"
              subtitle="OP05-119"
              imageUrl={null}
              right={
                <>
                  <span>{formatMoney(18.2)}</span>
                  <PriceDelta amount={-1.1} ratio={-0.06} />
                </>
              }
            />
          </div>
        </Variants>
      </Section>

      <Section name="TopNav">
        <Variants>
          <TopNav search={<SearchField value={query} onChange={setQuery} placeholder="Find a card…" />} right={<ThemeToggle />} />
        </Variants>
      </Section>

      <Section name="BottomTabBar">
        <Variants>
          <div className="flex flex-col gap-2">
            <p className="text-xs text-dim">visible below md</p>
            <BottomTabBar />
          </div>
        </Variants>
      </Section>

      <Section name="ThemeToggle">
        <Variants>
          <ThemeToggle />
        </Variants>
      </Section>

      <Section name="MoneyDisplay">
        <Variants>
          <div className="flex flex-wrap items-end gap-6">
            <MoneyDisplay amount={4812.4} size="md" />
            <MoneyDisplay amount={4812.4} size="lg" />
            <MoneyDisplay amount={null} />
          </div>
        </Variants>
      </Section>

      <Section name="EmptyState">
        <Variants>
          <div className="flex flex-col gap-4">
            <EmptyState
              title="No cards yet"
              body="Add your first card to start tracking value."
              action={<Button>Add a card</Button>}
            />
            <EmptyState title="No results" body="Try a different search." />
          </div>
        </Variants>
      </Section>
    </div>
  );
}
