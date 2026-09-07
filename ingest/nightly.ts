// Nightly job, run by the "Daily price ingest" workflow right after ingest/daily.ts:
//   1. materialize portfolio_history for `date` (every binder, every user — one statement),
//   2. evaluate every price alert against the market price in force on `date` and email crossings.
// Idempotent per date (spec §9): history rows are upserted, and an alert that already fired stays
// disarmed until the price crosses back, so a re-run never emails twice. An email that fails — or
// can't be sent because Resend isn't configured — leaves the alert armed so it retries next night.
import { db, closeDb } from "@/lib/db";
import { isCalendarDate } from "./prices";
import { evaluateAlert, type Direction } from "@/lib/alerts";
import { alertEmail, mailerFromEnv, type Mailer } from "./mailer";

export interface NightlyOptions {
  date: string;          // YYYY-MM-DD — the ingest date whose prices are "today"
  mailer: Mailer | null; // null = email disabled (logs what it would have sent)
  appUrl: string;        // origin for links in emails
  now?: () => string;    // ISO timestamp for last_fired_at; tests pin it
}

export interface NightlySummary {
  date: string; portfolios: number; alerts: number; fired: number; rearmed: number;
  emailFailed: number; skippedNoMailer: number; emailDisabled: boolean; elapsedMs: number;
}

/** INSERT … SELECT over all binders: value = Σ quantity × market in force on `date` (the newest
 *  snapshot at or before it). Unpriced copies contribute nothing; an empty binder is 0. */
export async function materializePortfolioHistory(date: string): Promise<number> {
  const c = await db();
  const r = await c.execute({
    sql: `INSERT INTO portfolio_history (portfolio_id, date, total_value)
          SELECT po.id, ?, COALESCE(SUM(ci.quantity * (
                   SELECT ps.market FROM price_snapshots ps
                   WHERE ps.printing_id = ci.printing_id AND ps.date <= ? ORDER BY ps.date DESC LIMIT 1)), 0)
          FROM portfolios po LEFT JOIN collection_items ci ON ci.portfolio_id = po.id
          WHERE true GROUP BY po.id
          ON CONFLICT(portfolio_id, date) DO UPDATE SET total_value = excluded.total_value`,
    args: [date, date],
  });
  return r.rowsAffected;
}

interface AlertJoin {
  id: number; email: string; cardId: number; cardName: string; setName: string; number: string | null; subtype: string;
  direction: Direction; threshold: number; armed: boolean; market: number | null;
}

async function loadAlerts(date: string): Promise<AlertJoin[]> {
  const c = await db();
  const rows = (await c.execute({
    sql: `SELECT a.id, a.direction, a.threshold, a.armed, u.email,
                 ca.id AS card_id, ca.name AS card_name, ca.number, se.name AS set_name, p.subtype,
                 (SELECT ps.market FROM price_snapshots ps WHERE ps.printing_id = a.printing_id AND ps.date <= ? ORDER BY ps.date DESC LIMIT 1) AS market
          FROM price_alerts a
          JOIN "user" u ON u.id = a.user_id
          JOIN printings p ON p.id = a.printing_id
          JOIN cards ca ON ca.id = p.card_id
          JOIN sets se ON se.id = ca.set_id
          ORDER BY a.id`,
    args: [date],
  })).rows;
  return rows.map((x) => ({
    id: Number(x.id), email: String(x.email), cardId: Number(x.card_id), cardName: String(x.card_name), setName: String(x.set_name),
    number: x.number == null ? null : String(x.number), subtype: String(x.subtype), direction: String(x.direction) as Direction,
    threshold: Number(x.threshold), armed: Number(x.armed) === 1, market: x.market == null ? null : Number(x.market),
  }));
}

export async function runNightly(opts: NightlyOptions): Promise<NightlySummary> {
  if (!isCalendarDate(opts.date)) throw new Error(`runNightly: date must be YYYY-MM-DD, got ${opts.date}`);
  const startedAt = Date.now();
  const now = opts.now ?? (() => new Date().toISOString());
  const s: NightlySummary = { date: opts.date, portfolios: 0, alerts: 0, fired: 0, rearmed: 0, emailFailed: 0, skippedNoMailer: 0, emailDisabled: opts.mailer === null, elapsedMs: 0 };

  s.portfolios = await materializePortfolioHistory(opts.date);
  console.log(`[nightly] portfolio_history: ${s.portfolios} binders valued as of ${opts.date}`);

  const c = await db();
  const alerts = await loadAlerts(opts.date);
  s.alerts = alerts.length;
  for (const a of alerts) {
    const decision = evaluateAlert(a, a.market);
    if (decision === "rearm") {
      await c.execute({ sql: "UPDATE price_alerts SET armed = 1 WHERE id = ?", args: [a.id] });
      s.rearmed++;
    } else if (decision === "fire") {
      if (!opts.mailer) {
        // Not marked fired: the crossing is still pending and emails once Resend is configured.
        console.warn(`[nightly] alert ${a.id} crossed (${a.cardName} ${a.direction} ${a.threshold}, now ${a.market}) but email is disabled`);
        s.skippedNoMailer++;
        continue;
      }
      try {
        await opts.mailer.send(alertEmail({
          to: a.email, cardName: a.cardName, setName: a.setName, number: a.number, subtype: a.subtype,
          direction: a.direction, threshold: a.threshold, market: a.market!, cardUrl: new URL(`/cards/${a.cardId}`, opts.appUrl).href,
        }));
        await c.execute({ sql: "UPDATE price_alerts SET armed = 0, last_fired_at = ?, last_fired_price = ? WHERE id = ?", args: [now(), a.market, a.id] });
        s.fired++;
      } catch (e) {
        // Stays armed → retried next night (spec §9).
        console.error(`[nightly] alert ${a.id} email FAILED: ${e instanceof Error ? e.message : String(e)}`);
        s.emailFailed++;
      }
    }
  }
  s.elapsedMs = Date.now() - startedAt;
  console.log(`[nightly] alerts=${s.alerts} fired=${s.fired} rearmed=${s.rearmed} emailFailed=${s.emailFailed} skippedNoMailer=${s.skippedNoMailer} emailDisabled=${s.emailDisabled} elapsedMs=${s.elapsedMs}`);
  return s;
}

// CLI entry: npx tsx ingest/nightly.ts [YYYY-MM-DD]   (or INGEST_DATE, like ingest/daily.ts)
const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("ingest/nightly.ts");
if (isMain) {
  const raw = process.argv[2] ?? process.env.INGEST_DATE;
  const argDate = raw && raw.trim() ? raw.trim() : undefined;
  if (argDate !== undefined && !isCalendarDate(argDate)) {
    console.error("usage: tsx ingest/nightly.ts [YYYY-MM-DD]");
    process.exit(2);
  }
  const appUrl = process.env.APP_URL ?? process.env.BETTER_AUTH_URL;
  if (!appUrl) {
    console.error("APP_URL (or BETTER_AUTH_URL) is required for links in alert emails");
    process.exit(2);
  }
  void runNightly({ date: argDate ?? new Date().toISOString().slice(0, 10), mailer: mailerFromEnv(), appUrl })
    .then((s) => {
      closeDb();
      console.log(`NIGHTLY_SUMMARY ${JSON.stringify(s)}`);
      // A crossing that could not be emailed is a real gap the owner must know about — and in CI a
      // pending alert with Resend unconfigured is exactly that (GitHub emails on failure).
      if (s.emailFailed > 0 || (process.env.CI && s.skippedNoMailer > 0)) process.exitCode = 1;
    })
    .catch((e) => { console.error(e); closeDb(); process.exitCode = 1; });
}
