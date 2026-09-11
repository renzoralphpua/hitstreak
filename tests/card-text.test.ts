// TCGplayer ships card attributes as HTML fragments — ~29,000 cards in the catalog carry markup in
// CardText, Attack 1 and Attack 2. It is stripped, never rendered: this is third-party content the
// ingest does not control, so a single <img onerror> upstream must not become an XSS hole.
import { describe, it, expect } from "vitest";
import { toPlainText, hasText } from "@/lib/card-text";

describe("toPlainText", () => {
  it("keeps line breaks and drops the rest of the markup", () => {
    expect(toPlainText("A Legendary Storm Is Stirring!<br>\nA thunderous roar from above")).toBe(
      "A Legendary Storm Is Stirring!\nA thunderous roar from above"
    );
    expect(toPlainText("<strong>Mega Rayquaza ex</strong> brings <em>power</em>")).toBe(
      "Mega Rayquaza ex brings power"
    );
    expect(toPlainText("cost<br/>effect<BR />more")).toBe("cost\neffect\nmore");
  });

  it("strips a script or an event handler instead of ever letting it through", () => {
    expect(toPlainText('<script>alert(1)</script>hello')).toBe("alert(1)hello");
    expect(toPlainText('<img src=x onerror="alert(1)">caption')).toBe("caption");
    expect(toPlainText('<a href="javascript:alert(1)">click</a>')).toBe("click");
  });

  it("decodes entities AFTER stripping, so escaped markup stays visible text", () => {
    // Decoding first would turn this back into a tag and then strip it — the opposite of the point.
    expect(toPlainText("&lt;script&gt;x&lt;/script&gt;")).toBe("<script>x</script>");
    expect(toPlainText("Fire &amp; Water")).toBe("Fire & Water");
    expect(toPlainText("&mdash;&hellip;&nbsp;end")).toBe("—… end");
    expect(toPlainText("&#65;&#x42;")).toBe("AB");
  });

  it("drops decoded control characters rather than printing invisible junk", () => {
    expect(toPlainText("a&#0;b")).toBe("ab");
    expect(toPlainText("a&#10;b")).toBe("ab");
  });

  it("leaves an unknown entity alone rather than mangling it", () => {
    expect(toPlainText("100&percnt; sure")).toBe("100&percnt; sure");
  });

  it("collapses the whitespace that stripping leaves behind", () => {
    expect(toPlainText("<p>one</p>  <p>two</p>")).toBe("one\ntwo");
    expect(toPlainText("a<br><br><br><br>b")).toBe("a\n\nb");
    expect(toPlainText("   padded   ")).toBe("padded");
  });

  it("handles the values that are not strings at all", () => {
    expect(toPlainText(null)).toBe("");
    expect(toPlainText(undefined)).toBe("");
    expect(toPlainText(42)).toBe("42");
  });
});

describe("hasText", () => {
  it("is false for a value that is only markup", () => {
    expect(hasText("<br>")).toBe(false);
    expect(hasText("<strong></strong>")).toBe(false);
    expect(hasText("   ")).toBe(false);
    expect(hasText("<strong>x</strong>")).toBe(true);
  });
});
