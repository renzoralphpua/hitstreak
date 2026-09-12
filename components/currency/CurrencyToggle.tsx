"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CURRENCIES, CURRENCY_COOKIE, type CurrencyCode } from "@/lib/currency";
import { useDisplay } from "./CurrencyProvider";

/** A year. The choice is a preference, not a session — signing out should not reset it to dollars. */
const MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Switches the currency every figure is rendered in.
 *
 * Writes a COOKIE and then refreshes, rather than holding the choice in React state: money is
 * rendered by server components all over this app, and only the server can re-render those. The
 * round trip is what makes the whole page agree, including the parts React never sees.
 *
 * `available` is the set we hold a rate for. A currency the feed has not delivered is shown but
 * disabled — better to say a rate is missing than to convert at a guess or hide the option with no
 * explanation.
 */
export default function CurrencyToggle({ available }: { available: CurrencyCode[] }) {
  const router = useRouter();
  const { code, asOf } = useDisplay();
  const [pending, start] = useTransition();
  const have = new Set<CurrencyCode>([...available, "USD"]);

  const choose = (next: string) => {
    document.cookie = `${CURRENCY_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=${MAX_AGE}; samesite=lax`;
    start(() => router.refresh());
  };

  return (
    <label className="flex items-center gap-1.5">
      <span className="sr-only">Display currency</span>
      <select
        value={code}
        disabled={pending}
        onChange={(e) => choose(e.target.value)}
        // A rate is only ever as fresh as the last nightly run, and saying so costs one attribute.
        title={code === "USD" ? "Prices are in US dollars" : `Converted at the rate from ${asOf ?? "an unknown date"}`}
        className="num rounded-full border border-hairline bg-surface px-2.5 py-1.5 text-caption text-ink disabled:opacity-60"
      >
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code} disabled={!have.has(c.code)}>
            {c.code}
            {have.has(c.code) ? "" : " — no rate yet"}
          </option>
        ))}
      </select>
    </label>
  );
}
