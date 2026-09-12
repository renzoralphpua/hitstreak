// Nightly job, run by the "Daily price ingest" workflow right after ingest/daily.ts:
//   1. materialize collection_history for `date` (every collection, every user — one statement),
//   2. evaluate every price alert against the CURRENT price (latest_prices) and email crossings.
// History is valued as of `date` so a failed night can be re-run under its own date; alerts
// deliberately are NOT. The state machine is not order-aware, so judging a fired alert by an older
// date's price could re-arm it (→ a duplicate email the next night) or fire an armed one on a stale
// price and link. In the scheduled run the two agree (latest_prices always equals the newest
// snapshot — see the invariant in ingest/prices.ts); they differ only on an old-date re-run.
// Idempotent per date (spec §9): history rows are upserted, and an alert that already fired stays
// disarmed until the price crosses back, so a re-run never emails twice. An email that fails — or
// can't be sent because Resend isn't configured — leaves the alert armed so it retries next night.
import { db, closeDb } from "@/lib/db";
import { isCalendarDate } from "./prices";
import { evaluateAlert, type Direction } from "@/lib/alerts";
import { alertEmail, mailerFromEnv, type Mailer } from "./mailer";
import { ingestRates } from "./fx";

export interface NightlyOptions {
  date: string;          // YYYY-MM-DD — the date collection_history is valued as of (alerts always use the current price)
  mailer: Mailer | null; // null = email disabled (logs what it would have sent)
  appUrl: string;        // origin for links in emails
  now?: () => string;    // ISO timestamp for last_fired_at; tests pin it
}

export interface NightlySummary {
  date: string; collections: number; alerts: number; fired: number; rearmed: number;
  emailFailed: number; skippedNoMailer: number; emailDisabled: boolean;
  /** Display-currency rates written. 0 means the feed was unreachable and dollars still work. */
  fxRates: number;
  elapsedMs: number;
}

/** INSERT … SELECT over all collections: value = Σ quantity × market in force on `date` (the newest
 *  snapshot at or before it). Unpriced copies contribute nothing; an empty collection is 0. */
export async function materializeCollectionHistory(date: string): Promise<number> {
  const c = await db();
  const r = await c.execute({
    sql: `INSERT INTO collection_history (collection_id, date, total_value)
          SELECT po.id, ?, COALESCE(SUM(ci.quantity * (
                   SELECT ps.market FROM price_snapshots ps
                   WHERE ps.printing_id = ci.printing_id AND ps.date <= ? ORDER BY ps.date DESC LIMIT 1)), 0)
          FROM collections po LEFT JOIN collection_items ci ON ci.collection_id = po.id
          WHERE true GROUP BY po.id
          ON CONFLICT(collection_id, date) DO UPDATE SET total_value = excluded.total_value`,
    args: [date, date],
  });
  return r.rowsAffected;
}

interface AlertJoin {
  id: number; email: string; cardId: number; cardName: string; setName: string; number: string | null; subtype: string;
  direction: Direction; threshold: number; armed: boolean; market: number | null;
}

/** Every alert with its owner, card and the CURRENT market price (latest_prices — the same price
 *  /alerts shows and the email calls "today"). Not as-of-date on purpose; see the header. */
async function loadAlerts(): Promise<AlertJoin[]> {
  const c = await db();
  const rows = (await c.execute(
    `SELECT a.id, a.direction, a.threshold, a.armed, u.email,
            ca.id AS card_id, ca.name AS card_name, ca.number, se.name AS set_name, p.subtype, lp.market
     FROM price_alerts a
     JOIN "user" u ON u.id = a.user_id
     JOIN printings p ON p.id = a.printing_id
     JOIN cards ca ON ca.id = p.card_id
     JOIN sets se ON se.id = ca.set_id
     LEFT JOIN latest_prices lp ON lp.printing_id = a.printing_id
     ORDER BY a.id`
  )).rows;
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
  const s: NightlySummary = { date: opts.date, collections: 0, alerts: 0, fired: 0, rearmed: 0, emailFailed: 0, skippedNoMailer: 0, emailDisabled: opts.mailer === null, fxRates: 0, elapsedMs: 0 };

  // Display-only FX, and not worth failing a night's run over: a missing rate falls back to dollars,
  // and a stale one keeps working while saying how old it is.
  try {
    const fx = await ingestRates();
    s.fxRates = fx.written;
    console.log(`[nightly] fx: ${fx.written} rates as of ${fx.date}${fx.skipped.length ? ` (no rate for ${fx.skipped.join(", ")})` : ""}`);
  } catch (e) {
    console.log(`[nightly] fx: skipped — ${e instanceof Error ? e.message : String(e)}`);
  }

  s.collections = await materializeCollectionHistory(opts.date);
  console.log(`[nightly] collection_history: ${s.collections} collections valued as of ${opts.date}`);

  const c = await db();
  const alerts = await loadAlerts();
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
  // The origin is only used for links inside alert emails, so it is required only once Resend is
  // configured — a missing APP_URL must never cost a night of collection_history.
  const mailer = mailerFromEnv();
  const appUrl = process.env.APP_URL ?? process.env.BETTER_AUTH_URL;
  if (mailer && !appUrl) {
    console.error("APP_URL (or BETTER_AUTH_URL) is required for links in alert emails when Resend is configured");
    process.exit(2);
  }
  void runNightly({ date: argDate ?? new Date().toISOString().slice(0, 10), mailer, appUrl: appUrl ?? "http://localhost:3000" })
    .then((s) => {
      closeDb();
      console.log(`NIGHTLY_SUMMARY ${JSON.stringify(s)}`);
      // A crossing that could not be emailed is a real gap the owner must know about — and in CI a
      // pending alert with Resend unconfigured is exactly that (GitHub emails on failure).
      if (s.emailFailed > 0 || (process.env.CI && s.skippedNoMailer > 0)) process.exitCode = 1;
    })
    .catch((e) => { console.error(e); closeDb(); process.exitCode = 1; });
}
