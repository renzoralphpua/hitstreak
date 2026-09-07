// lib/alerts.ts
// Email price alerts. `evaluateAlert` is the whole state machine and is pure so the nightly job and
// the tests share one definition. Rows are scoped by user_id; the nightly (ingest/nightly.ts) is
// the only reader that crosses users.
import { db } from "@/lib/db";
import { getCardDetail, thirtyDayChange, type Change, type PrintingPrice } from "@/lib/catalog";

export const DIRECTIONS = ["above", "below"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const MAX_ALERTS_PER_USER = 100;
const MAX_THRESHOLD = 1_000_000;

export type Decision = "fire" | "rearm" | "none";

/** Armed + price at/over the line → fire (inclusive: a price AT the threshold counts). Fired + price
 *  strictly back on the other side → re-arm. Anything else, or no price → nothing. */
export function evaluateAlert(a: { direction: Direction; threshold: number; armed: boolean }, market: number | null): Decision {
  if (market == null || !Number.isFinite(market)) return "none";
  const crossed = a.direction === "above" ? market >= a.threshold : market <= a.threshold;
  if (a.armed) return crossed ? "fire" : "none";
  return crossed ? "none" : "rearm";
}

export interface Alert {
  id: number; printingId: number; cardId: number; cardName: string; setName: string; number: string | null; subtype: string; imageUrl: string | null;
  direction: Direction; threshold: number; armed: boolean; lastFiredAt: string | null; lastFiredPrice: number | null; createdAt: string;
  market: number | null; priceDate: string | null; change30d: Change | null;
}

/** Triggered (fired, waiting to re-arm) first, then watching; newest first within each. */
export async function listAlerts(userId: string, asOf = new Date().toISOString().slice(0, 10)): Promise<Alert[]> {
  const c = await db();
  const rows = (await c.execute({
    sql: `SELECT a.id, a.printing_id, a.direction, a.threshold, a.armed, a.last_fired_at, a.last_fired_price, a.created_at,
                 ca.id AS card_id, ca.name AS card_name, ca.number, ca.image_url, se.name AS set_name, p.subtype, lp.market, lp.date AS price_date
          FROM price_alerts a
          JOIN printings p ON p.id = a.printing_id
          JOIN cards ca ON ca.id = p.card_id
          JOIN sets se ON se.id = ca.set_id
          LEFT JOIN latest_prices lp ON lp.printing_id = p.id
          WHERE a.user_id = ?
          ORDER BY a.armed ASC, a.created_at DESC, a.id DESC`,
    args: [userId],
  })).rows;
  return Promise.all(rows.map(async (x) => ({
    id: Number(x.id), printingId: Number(x.printing_id), cardId: Number(x.card_id), cardName: String(x.card_name), setName: String(x.set_name),
    number: x.number == null ? null : String(x.number), subtype: String(x.subtype), imageUrl: x.image_url == null ? null : String(x.image_url),
    direction: String(x.direction) as Direction, threshold: Number(x.threshold), armed: Number(x.armed) === 1,
    lastFiredAt: x.last_fired_at == null ? null : String(x.last_fired_at), lastFiredPrice: x.last_fired_price == null ? null : Number(x.last_fired_price),
    createdAt: String(x.created_at), market: x.market == null ? null : Number(x.market), priceDate: x.price_date == null ? null : String(x.price_date),
    change30d: await thirtyDayChange(Number(x.printing_id), asOf),
  })));
}

export interface CreateAlertInput { printingId: number; direction: string; threshold: number }

export async function createAlert(userId: string, input: CreateAlertInput): Promise<number> {
  if (!(DIRECTIONS as readonly string[]).includes(input.direction)) throw new Error(`Direction must be one of ${DIRECTIONS.join(", ")}`);
  if (!Number.isFinite(input.threshold) || input.threshold <= 0 || input.threshold > MAX_THRESHOLD) throw new Error("Threshold must be a price above zero");
  const c = await db();
  if ((await c.execute({ sql: "SELECT 1 FROM printings WHERE id = ?", args: [input.printingId] })).rows.length === 0) throw new Error("Printing not found");
  const n = Number((await c.execute({ sql: "SELECT COUNT(*) AS n FROM price_alerts WHERE user_id = ?", args: [userId] })).rows[0].n);
  if (n >= MAX_ALERTS_PER_USER) throw new Error(`You can have at most ${MAX_ALERTS_PER_USER} alerts`);
  const r = await c.execute({
    sql: "INSERT INTO price_alerts (user_id, printing_id, direction, threshold) VALUES (?, ?, ?, ?) RETURNING id",
    args: [userId, input.printingId, input.direction, input.threshold],
  });
  return Number(r.rows[0].id);
}

export async function deleteAlert(userId: string, id: number): Promise<boolean> {
  const c = await db();
  const r = await c.execute({ sql: "DELETE FROM price_alerts WHERE id = ? AND user_id = ?", args: [id, userId] });
  return r.rowsAffected === 1;
}

/** The card behind a printing, shaped for the new-alert form (`/alerts?printing=`). */
export interface AlertCard { printingId: number; name: string; subtitle: string; imageUrl: string | null; printings: PrintingPrice[] }
export async function getAlertCard(userId: string, printingId: number): Promise<AlertCard | null> {
  const c = await db();
  const r = await c.execute({ sql: "SELECT card_id FROM printings WHERE id = ?", args: [printingId] });
  if (r.rows.length === 0) return null;
  const detail = await getCardDetail(userId, Number(r.rows[0].card_id));
  if (!detail) return null;
  return {
    printingId,
    name: detail.card.name,
    subtitle: [detail.card.setName, detail.card.number].filter(Boolean).join(" · "),
    imageUrl: detail.card.imageUrl,
    printings: detail.printings.map(({ printingId, subtype, market, priceDate }) => ({ printingId, subtype, market, priceDate })),
  };
}
