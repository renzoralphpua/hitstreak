// `?from=` is untrusted — it arrives in the URL and anyone can type one. These cases pin both
// halves: an attacker cannot point the arrow off-origin, and cannot put words in it either.
import { describe, it, expect } from "vitest";
import { collectionIdFromPath, resolveBack } from "@/lib/back-link";

const SET = { href: "/sets/9", label: "Obsidian Flames" };

describe("collectionIdFromPath", () => {
  it("reads the id only from a real collection path", () => {
    expect(collectionIdFromPath("/collections/12")).toBe(12);
    expect(collectionIdFromPath("/collections/12?view=grid")).toBe(12);
    expect(collectionIdFromPath("/collections/12/extra")).toBe(12);
    expect(collectionIdFromPath("/collections")).toBeNull();
    expect(collectionIdFromPath("/collections/abc")).toBeNull();
    expect(collectionIdFromPath("/collectionsevil/1")).toBeNull();
    expect(collectionIdFromPath("/sets/12")).toBeNull();
  });
});

describe("resolveBack", () => {
  it("falls back to the set when there is no usable from", () => {
    for (const v of [undefined, "", 7, {}, "not-a-path"]) {
      expect(resolveBack(v, SET)).toEqual(SET);
    }
  });

  it("returns to the collection you came from, named", () => {
    expect(resolveBack("/collections/12?view=grid", SET, { collectionName: "Main Binder" })).toEqual({
      href: "/collections/12?view=grid",
      label: "Main Binder",
    });
  });

  it("refuses a collection the caller could not look up", () => {
    // No name means the page could not find that collection for this user. Linking anyway would
    // offer a route into someone else's collection — so the whole parameter is discarded.
    expect(resolveBack("/collections/999", SET, { collectionName: null })).toEqual(SET);
    expect(resolveBack("/collections/999", SET)).toEqual(SET);
  });

  it("names the other entry points without trusting the URL for the words", () => {
    expect(resolveBack("/home", SET)).toEqual({ href: "/home", label: "Home" });
    expect(resolveBack("/alerts", SET)).toEqual({ href: "/alerts", label: "Alerts" });
    expect(resolveBack("/decks/mine/3", SET)).toEqual({ href: "/decks/mine/3", label: "Decks" });
    // A set path keeps the real set name, which came from the database, not from the parameter.
    expect(resolveBack("/sets/9", SET)).toEqual(SET);
  });

  it("never points off-origin, whatever the parameter tries", () => {
    for (const evil of [
      "//evil.example.com",
      "/\\evil.example.com",
      "https://evil.example.com/collections/1",
      "/\t/evil.example.com",
      "javascript:alert(1)",
    ]) {
      const back = resolveBack(evil, SET, { collectionName: "Main Binder" });
      expect(back.href, evil).toBe("/sets/9");
    }
  });

  it("ignores an unknown internal path rather than linking somewhere with no label", () => {
    expect(resolveBack("/admin/decks", SET)).toEqual(SET);
  });
});
