import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { tmpDb } from "./helpers/tmpdb";
const tmp = tmpDb("search-route");
import { closeDb } from "@/lib/db";
import { seedMiniCatalog } from "./helpers/seed";
import { NextRequest } from "next/server";

// The session is the only thing the route reaches for that a plain node test can't provide.
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession }));

import { GET } from "@/app/api/search/route";

const req = (qs: string) => new NextRequest(`http://localhost/api/search${qs}`);

beforeAll(async () => { await seedMiniCatalog(); });
afterAll(() => { closeDb(); tmp.clean(); });
beforeEach(() => { getSession.mockReset().mockResolvedValue({ user: { id: "user_1" } }); });

describe("GET /api/search", () => {
  it("returns matching hits with their printings", async () => {
    const res = await GET(req("?q=pika"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0]).toMatchObject({ name: "Pikachu", setName: "Prismatic Evolutions", gameSlug: "pokemon" });
    expect(body.hits[0].printings.map((p: { subtype: string }) => p.subtype)).toEqual(["Normal", "Reverse Holofoil"]);
  });

  it("filters by game", async () => {
    expect((await (await GET(req("?q=shanks&game=pokemon"))).json()).hits).toEqual([]);
    expect((await (await GET(req("?q=shanks&game=one-piece"))).json()).hits).toHaveLength(1);
  });

  it("returns no hits for a too-short query", async () => {
    const res = await GET(req("?q=a"));
    expect(res.status).toBe(200);
    // `jump` is always present now: the palette asks for sets and decks alongside cards.
    expect(await res.json()).toEqual({ hits: [], jump: [] });
  });

  it("401s without a session", async () => {
    getSession.mockResolvedValue(null);
    const res = await GET(req("?q=pika"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not signed in" });
  });
});
