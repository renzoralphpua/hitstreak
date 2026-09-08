// lib/decks/resolve.ts — decklist text → catalog cards. Shared by the admin curation screen (Task 8) and
// scripts/import-deck.mts. Exact matches resolve to the cheapest priced printing's card (any set); anything
// else returns candidates for a human to pick from.
import { db } from "@/lib/db";
import type { Row } from "@libsql/client";
import { baseName } from "./identity";
import type { GameSlug, Zone } from "./types";

export interface ParsedLine { raw: string; quantity: number; text: string; zone: Zone }
export interface Candidate { cardId: number; name: string; setName: string; number: string | null }
export interface Resolution { line: ParsedLine; cardId: number | null; candidates: Candidate[] }

// A section header is the header word alone on its line, optionally followed by ":" / "(" and a count —
// "Pokémon: 8", "Trainer: 4", "Energy (10)", "Leader", "Runes:". Anything longer ("Energy Retrieval") is a card.
const HEADER_TAIL = String.raw`\s*(?:[:：]\s*\d*|\(\s*\d*\s*\))?$`;
const header = (words: string, zone: Zone): [RegExp, Zone] => [new RegExp(`^(?:${words})${HEADER_TAIL}`, "i"), zone];
const HEADERS: Array<[RegExp, Zone]> = [
  header("pok[eé]mon|trainers?|energy|main(?: deck)?|deck|cards", "main"),
  header("leader", "leader"), header("legend", "legend"), header("(?:chosen )?champion", "champion"),
  header("runes?", "rune"), header("battlefields?", "battlefield"),
];
const SKIP = /^(total\b|\d+\s*cards?\s*$|don!!|#|\/\/)/i;
const SET_TAIL = /\s+[A-Z]{2,4}\s+\d{1,3}[a-z]?$/;          // "… MEW 4", "… OBF 125"
const PAREN_TAIL = /\s*\((?:[A-Z]{2,4}-)?\d{1,3}[a-z]?\)$/;  // "… (OGN-006)"

export function parseDecklist(text: string, game: GameSlug): ParsedLine[] {
  void game; // every game starts in "main"; headers move the zone
  const out: ParsedLine[] = [];
  let zone: Zone = "main";
  for (const rawLine of text.split(/\r?\n/)) {
    const raw = rawLine.trim();
    if (!raw || SKIP.test(raw)) continue;
    const h = HEADERS.find(([re]) => re.test(raw));
    if (h) { zone = h[1]; continue; }
    let quantity = 1, text = raw;
    let m = raw.match(/^(\d+)\s*[xX×]?\s+(.+)$/);
    if (m) { quantity = Number(m[1]); text = m[2]; }
    else if ((m = raw.match(/^(.+?)\s*[xX×]\s*(\d+)$/))) { quantity = Number(m[2]); text = m[1]; }
    text = text.replace(SET_TAIL, "").replace(PAREN_TAIL, "").trim();
    if (!text) continue;
    out.push({ raw, quantity, text, zone });
  }
  return out;
}

const OP_NUMBER = /^([A-Z]{1,3}\d{2}-\d{3})\b\s*(.*)$/;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (ch) => "\\" + ch);
// One row per card with its cheapest priced printing, so ORDER BY market puts the reprint a buyer would pick first.
const CARD_SELECT = `SELECT ca.id, ca.name, se.name AS set_name, ca.number,
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
