// lib/decks/decklist.ts
// The db-free half of decklist handling — text in (`parseDecklist`), text out (`formatDecklist`), and
// resolved lines folded into deck lines (`mergeResolved`) — split out of lib/decks/resolve.ts so the
// curation form ("use client") can reuse the merge without dragging lib/db into the client bundle
// (same reason as lib/decks/gap-math.ts and lib/ranges.ts). Nothing here may import a db-backed module
// at runtime — tests/ranges.test.ts guards that; `import type` is erased and allowed.
import type { DeckLineInput } from "./data";
import { ZONES, type GameSlug, type Zone } from "./types";

export interface ParsedLine { raw: string; quantity: number; text: string; zone: Zone }
export interface Candidate { cardId: number; name: string; setName: string; number: string | null }
export interface Resolution { line: ParsedLine; cardId: number | null; candidates: Candidate[] }

// A section header is the header word alone on its line, optionally followed by ":" / "(" and a count —
// "Pokémon: 8", "Trainer: 4", "Energy (10)", "Leader", "Runes:", One Piece "Character" / "Event" / "Stage".
// Anything longer ("Energy Retrieval") is a card.
const HEADER_TAIL = String.raw`\s*(?:[:：]\s*\d*|\(\s*\d*\s*\))?$`;
const header = (words: string, zone: Zone): [RegExp, Zone] => [new RegExp(`^(?:${words})${HEADER_TAIL}`, "i"), zone];
const HEADERS: Array<[RegExp, Zone]> = [
  header("pok[eé]mon|trainers?|energy|main(?: deck)?|deck|cards|characters?|events?|stages?", "main"),
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

// Header words the HEADERS alternation above already accepts, one per zone — keep the two in step.
const ZONE_HEADER: Record<Zone, string> = { main: "Main", leader: "Leader", legend: "Legend", champion: "Champion", rune: "Runes", battlefield: "Battlefields" };

/**
 * Renders a deck as text `parseDecklist` can read back: one `N Name` line per deck line, grouped under
 * the zone headers the parser recognises. Only zones the game uses appear, and a single-zone game
 * (Pokémon) gets no headers at all.
 *
 * Honest limitation: this writes names, so a line whose card is NOT its name's cheapest printing comes
 * back as that cheaper printing's card id when it is resolved again. Round-tripping is for editing a
 * list, not for preserving printings.
 */
export function formatDecklist(deck: { gameSlug: GameSlug; cards: Array<{ zone: Zone; quantity: number; name: string }> }): string {
  const out: string[] = [];
  for (const zone of ZONES[deck.gameSlug]) {
    const lines = deck.cards.filter((l) => l.zone === zone);
    if (lines.length === 0) continue;
    if (ZONES[deck.gameSlug].length > 1) out.push(`${ZONE_HEADER[zone]}:`);
    for (const l of lines) out.push(`${l.quantity} ${l.name}`);
    out.push("");
  }
  return out.join("\n").trim();
}

/**
 * Resolved lines → deck lines, summing quantities per card and zone. Exports list one line per PRINTING
 * ("3 Charmander MEW 4" + "1 Charmander PAF 7") and both resolve to the same card, which checkLines would
 * otherwise reject as a duplicate. Unresolved lines (cardId null) are skipped — callers gate on them first.
 */
export function mergeResolved(resolved: Resolution[]): DeckLineInput[] {
  const byKey = new Map<string, DeckLineInput>();
  for (const r of resolved) {
    if (r.cardId == null) continue;
    const k = `${r.cardId}|${r.line.zone}`;
    const cur = byKey.get(k);
    if (cur) cur.quantity += r.line.quantity;
    else byKey.set(k, { cardId: r.cardId, zone: r.line.zone, quantity: r.line.quantity });
  }
  return [...byKey.values()];
}
