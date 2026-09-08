// lib/decks/resolve.ts — decklist text → catalog cards. Shared by the admin curation screen (Task 8) and
// scripts/import-deck.mts. Exact matches resolve to the cheapest priced printing's card (any set); anything
// else returns candidates for a human to pick from.
// The text-only half (parseDecklist / formatDecklist / mergeResolved and the line types) lives in
// ./decklist, which is db-free so the curation form can import the merge; it is re-exported here so every
// server-side import site keeps reading the whole vocabulary from this module.
import { db } from "@/lib/db";
import type { Row } from "@libsql/client";
import { baseName } from "./identity";
import type { GameSlug } from "./types";
import type { Candidate, ParsedLine, Resolution } from "./decklist";

export * from "./decklist";

const OP_NUMBER = /^([A-Z]{1,3}\d{2}-\d{3})\b\s*(.*)$/;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (ch) => "\\" + ch);
// One row per card with its cheapest priced printing, so ORDER BY market puts the reprint a buyer would pick first.
const CARD_SELECT = `SELECT ca.id, ca.name, se.name AS set_name, ca.number, json_extract(ca.attrs, '$.Number') AS op_number,
                            (SELECT MIN(lp.market) FROM printings p JOIN latest_prices lp ON lp.printing_id = p.id WHERE p.card_id = ca.id) AS market
                     FROM cards ca JOIN sets se ON se.id = ca.set_id JOIN games g ON g.id = se.game_id`;
const CHEAPEST_FIRST = "ORDER BY market IS NULL, market, se.release_date DESC";
// The name prefilter is LIKE 'base name%', which for "Pikachu" also pulls every "Pikachu ex" / "Pikachu V…"
// printing (300+ rows in the real catalog); the exact baseName comparison happens in JS, so the window must
// be wide enough that no exact match is cut off before it.
const PREFILTER_LIMIT = 500;
const CANDIDATES = 5;

export async function resolveDecklist(game: GameSlug, lines: ParsedLine[]): Promise<Resolution[]> {
  const c = await db();
  const out: Resolution[] = [];
  for (const line of lines) {
    let exact: Row[];
    const num = game === "one-piece" ? line.text.toUpperCase().match(OP_NUMBER) : null;
    if (num) {
      exact = (await c.execute({
        sql: `${CARD_SELECT} WHERE g.slug = ? AND UPPER(json_extract(ca.attrs, '$.Number')) = ? ${CHEAPEST_FIRST} LIMIT 20`,
        args: [game, num[1]],
      })).rows;
    } else {
      // exact base-name match: candidates are every card whose baseName equals the text (case-insensitive)
      const want = baseName(line.text).toLowerCase();
      const rows = (await c.execute({
        sql: `${CARD_SELECT} WHERE g.slug = ? AND ca.name LIKE ? ESCAPE '\\' ${CHEAPEST_FIRST} LIMIT ${PREFILTER_LIMIT}`,
        args: [game, `${escapeLike(baseName(line.text))}%`],
      })).rows;
      exact = rows.filter((r) => baseName(String(r.name)).toLowerCase() === want);
      if (exact.length === 0 && rows.length > 0) {
        out.push({ line, cardId: null, candidates: rows.slice(0, CANDIDATES).map(toCandidate) });
        continue;
      }
      // One Piece identity is attrs.Number, and one name spans several numbers ("Nami" is OP01-016 and OP10-013
      // among others), so a bare name only resolves when every exact match shares one Number; otherwise the
      // human picks — one candidate per Number, cheapest first (rows are already cheapest-first).
      if (game === "one-piece") {
        const perNumber = new Map<string, Row>();
        for (const r of exact) { const k = String(r.op_number ?? "").toUpperCase(); if (!perNumber.has(k)) perNumber.set(k, r); }
        if (perNumber.size > 1) {
          out.push({ line, cardId: null, candidates: [...perNumber.values()].slice(0, CANDIDATES).map(toCandidate) });
          continue;
        }
      }
    }
    if (exact.length === 0) {
      const fuzzy = (await c.execute({
        sql: `SELECT ca.id, ca.name, se.name AS set_name, ca.number FROM cards ca JOIN sets se ON se.id = ca.set_id JOIN games g ON g.id = se.game_id
              WHERE g.slug = ? AND ca.name LIKE ? ESCAPE '\\' ORDER BY ca.name LIMIT ${CANDIDATES}`,
        args: [game, `%${escapeLike(line.text)}%`],
      })).rows;
      out.push({ line, cardId: null, candidates: fuzzy.map(toCandidate) });
      continue;
    }
    out.push({ line, cardId: Number(exact[0].id), candidates: exact.slice(0, CANDIDATES).map(toCandidate) });
  }
  return out;
}
const toCandidate = (r: Row): Candidate => ({ cardId: Number(r.id), name: String(r.name), setName: String(r.set_name), number: r.number == null ? null : String(r.number) });
