import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("nightly");
import { db, closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { createPortfolio, addItem } from "@/lib/portfolios";
import { createAlert } from "@/lib/alerts";
import { runNightly, materializePortfolioHistory } from "@/ingest/nightly";
import type { Mail, Mailer } from "@/ingest/mailer";

let seed: Awaited<ReturnType<typeof seedMiniCatalog>>;
let full: number, empty: number;

async function addUser(id: string, email: string) {
  await (await db()).execute({
    sql: `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, '2026-09-01', '2026-09-01')`,
    args: [id, id, email],
  });
}
const capture = () => { const sent: Mail[] = []; const mailer: Mailer = { send: async (m) => { sent.push(m); } }; return { sent, mailer }; };
const failing: Mailer = { send: async () => { throw new Error("resend down"); } };
const alertRow = async (id: number) => (await (await db()).execute({ sql: "SELECT armed, last_fired_at, last_fired_price FROM price_alerts WHERE id = ?", args: [id] })).rows[0];

beforeAll(async () => {
  seed = await seedMiniCatalog();
  await addUser("u1", "u1@example.com");
  await addUser("u2", "u2@example.com");
  full = (await createPortfolio("u1", "Main")).id;
  empty = (await createPortfolio("u2", "Empty")).id;
  await addItem("u1", full, { printingId: seed.printings.umbreonHolo, quantity: 2, condition: "NM" });   // 1465 as of 2026-09-01
  await addItem("u1", full, { printingId: seed.printings.pikachuNormal, quantity: 5, condition: "NM" }); // no snapshots → unpriced
});
afterAll(() => { closeDb(); tmp.clean(); });

describe("materializePortfolioHistory", () => {
  it("writes one row per binder valued from the snapshots as of that date, idempotently", async () => {
    expect(await materializePortfolioHistory("2026-09-07")).toBe(2);
    const rows = async () => (await (await db()).execute("SELECT portfolio_id, date, total_value FROM portfolio_history ORDER BY portfolio_id")).rows;
    expect(await rows()).toEqual([
      { portfolio_id: full, date: "2026-09-07", total_value: 2930 },
      { portfolio_id: empty, date: "2026-09-07", total_value: 0 },
    ]);
    await materializePortfolioHistory("2026-09-07");
    expect((await rows()).length).toBe(2);
    // an earlier date uses the price in force then (1100 on 2026-08-01)
    await materializePortfolioHistory("2026-08-01");
    expect((await rows()).find((r) => r.portfolio_id === full && r.date === "2026-08-01")?.total_value).toBe(2200);
  });
});

describe("runNightly alerts", () => {
  it("emails once on a crossing, disarms, and does not email again on a re-run", async () => {
    const id = await createAlert("u1", { printingId: seed.printings.umbreonHolo, direction: "above", threshold: 1450 });
    const { sent, mailer } = capture();
    const s1 = await runNightly({ date: "2026-09-07", mailer, appUrl: "https://hitstreak.test", now: () => "2026-09-07T21:06:00Z" });
    expect(s1).toMatchObject({ portfolios: 2, alerts: 1, fired: 1, rearmed: 0, emailFailed: 0, skippedNoMailer: 0, emailDisabled: false });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("u1@example.com");
    expect(sent[0].subject).toContain("Umbreon ex");
    expect(sent[0].text).toContain(`https://hitstreak.test/cards/${seed.cards.umbreon}`);
    expect(await alertRow(id)).toEqual({ armed: 0, last_fired_at: "2026-09-07T21:06:00Z", last_fired_price: 1465 });

    const s2 = await runNightly({ date: "2026-09-07", mailer, appUrl: "https://hitstreak.test" });
    expect(s2.fired).toBe(0);
    expect(sent).toHaveLength(1);
  });
  it("re-arms once the price is back over the line, then fires again on the next crossing", async () => {
    const c = await db();
    const id = Number((await c.execute("SELECT id FROM price_alerts WHERE user_id = 'u1'")).rows[0].id);
    // Two nights of price movement. The ingest keeps latest_prices equal to the newest snapshot
    // (ingest/prices.ts invariant); alerts read latest_prices, so mirror that here night by night.
    await c.execute("INSERT INTO price_snapshots (printing_id, date, market) VALUES (1, '2026-09-08', 1400), (1, '2026-09-09', 1500)");
    const { sent, mailer } = capture();
    await c.execute("UPDATE latest_prices SET date = '2026-09-08', market = 1400 WHERE printing_id = 1");
    expect((await runNightly({ date: "2026-09-08", mailer, appUrl: "https://hitstreak.test" })).rearmed).toBe(1);
    expect(Number((await alertRow(id)).armed)).toBe(1);
    await c.execute("UPDATE latest_prices SET date = '2026-09-09', market = 1500 WHERE printing_id = 1");
    expect((await runNightly({ date: "2026-09-09", mailer, appUrl: "https://hitstreak.test" })).fired).toBe(1);
    expect(sent).toHaveLength(1);
  });
  it("keeps the alert armed when the email fails or when email is not configured", async () => {
    const id = await createAlert("u2", { printingId: seed.printings.shanksNormal, direction: "below", threshold: 210 }); // 204.30 as of 2026-09-05
    const s1 = await runNightly({ date: "2026-09-07", mailer: failing, appUrl: "https://hitstreak.test" });
    expect(s1.emailFailed).toBe(1);
    expect(Number((await alertRow(id)).armed)).toBe(1);
    const s2 = await runNightly({ date: "2026-09-07", mailer: null, appUrl: "https://hitstreak.test" });
    expect(s2).toMatchObject({ emailDisabled: true, skippedNoMailer: 1 });
    expect(Number((await alertRow(id)).armed)).toBe(1);
  });
  it("ignores an unpriced printing", async () => {
    // State here: u1's Umbreon alert is fired (armed=0, and 1500 ≥ 1450 today → nothing),
    // u2's Shanks alert is still armed and pending (→ fires now that the mailer works), and this
    // Booster Bundle alert has no snapshots at all → neither fires nor re-arms.
    const id = await createAlert("u2", { printingId: seed.printings.bundle, direction: "below", threshold: 5 });
    const { sent, mailer } = capture();
    const s = await runNightly({ date: "2026-09-07", mailer, appUrl: "https://hitstreak.test" });
    expect(s).toMatchObject({ alerts: 3, fired: 1, rearmed: 0, emailFailed: 0, skippedNoMailer: 0 });
    expect(sent.map((m) => m.subject)).toEqual([expect.stringContaining("Shanks")]);
    expect(await alertRow(id)).toEqual({ armed: 1, last_fired_at: null, last_fired_price: null });
  });
  it("judges alerts by the current price, not the re-run date's: re-running an older night neither re-arms nor fires", async () => {
    // Umbreon is 1500 today (latest_prices) but was 1400 on 2026-09-08. Re-running that night must
    // leave the fired `above 1450` alert fired (re-arming it would email a duplicate the next night)
    // and must not fire a fresh `below 1450` alert on the stale 1400 — while history for the date is
    // still valued as of the date (2 × 1400).
    const c = await db();
    const fired = Number((await c.execute("SELECT id FROM price_alerts WHERE user_id = 'u1' AND direction = 'above'")).rows[0].id);
    expect(Number((await alertRow(fired)).armed)).toBe(0);
    const below = await createAlert("u1", { printingId: seed.printings.umbreonHolo, direction: "below", threshold: 1450 });
    const { sent, mailer } = capture();
    const s = await runNightly({ date: "2026-09-08", mailer, appUrl: "https://hitstreak.test" });
    expect(s).toMatchObject({ alerts: 4, fired: 0, rearmed: 0, emailFailed: 0, skippedNoMailer: 0 });
    expect(sent).toHaveLength(0);
    expect(Number((await alertRow(fired)).armed)).toBe(0);
    expect(await alertRow(below)).toEqual({ armed: 1, last_fired_at: null, last_fired_price: null });
    const h = (await c.execute({ sql: "SELECT total_value FROM portfolio_history WHERE portfolio_id = ? AND date = '2026-09-08'", args: [full] })).rows[0];
    expect(h.total_value).toBe(2800);
  });
  it("rejects a malformed date", async () => {
    await expect(runNightly({ date: "2026-9-7", mailer: null, appUrl: "x" })).rejects.toThrow(/YYYY-MM-DD/);
  });
});
