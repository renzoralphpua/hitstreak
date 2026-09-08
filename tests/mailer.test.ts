import { describe, it, expect, vi, afterEach } from "vitest";
import { alertEmail, createResendMailer, mailerFromEnv } from "@/ingest/mailer";

const input = {
  to: "u1@example.com", cardName: "Umbreon ex", setName: "Prismatic Evolutions", number: "161/131", subtype: "Holofoil",
  direction: "above" as const, threshold: 1450, market: 1465, cardUrl: "https://hitstreak.test/cards/1",
};

describe("alertEmail", () => {
  it("names the card, threshold, current price and link in subject, text and html", () => {
    const m = alertEmail(input);
    expect(m.to).toBe("u1@example.com");
    expect(m.subject).toBe("Umbreon ex rose above $1,450.00 — now $1,465.00");
    expect(m.text).toContain("Umbreon ex (Prismatic Evolutions · 161/131 · Holofoil) rose above your $1,450.00 line.");
    expect(m.text).toContain("Market price today: $1,465.00.");
    expect(m.text).toContain("View the card: https://hitstreak.test/cards/1");
    expect(m.text).toContain("Manage alerts: https://hitstreak.test/alerts");
    expect(m.html).toContain("<strong>Umbreon ex</strong>");
    expect(m.html).toContain("<strong>$1,450.00</strong>");
    expect(m.html).toContain("<strong>$1,465.00</strong>");
    expect(m.html).toContain('<a href="https://hitstreak.test/cards/1">View the card</a>');
    expect(m.html).toContain('<a href="https://hitstreak.test/alerts">Manage alerts</a>');
  });
  it("uses 'dropped below' for a below alert and skips a null number", () => {
    const m = alertEmail({ ...input, direction: "below", number: null, threshold: 210, market: 204.3 });
    expect(m.subject).toBe("Umbreon ex dropped below $210.00 — now $204.30");
    expect(m.text).toContain("Umbreon ex (Prismatic Evolutions · Holofoil) dropped below your $210.00 line.");
  });
  it("escapes html in the card name but leaves the plain text alone", () => {
    const m = alertEmail({ ...input, cardName: "Mr. <Mime> & \"Friends\"" });
    expect(m.html).toContain("Mr. &lt;Mime&gt; &amp; &quot;Friends&quot;");
    expect(m.html).not.toContain("<Mime>");
    expect(m.text).toContain('Mr. <Mime> & "Friends"');
  });
});

describe("createResendMailer", () => {
  it("POSTs the message as JSON to Resend with the bearer key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"id":"x"}', { status: 200 }));
    const mailer = createResendMailer({ apiKey: "re_test", from: "Hitstreak <alerts@hitstreak.app>", fetchImpl });
    await mailer.send({ to: "u1@example.com", subject: "Hi", text: "plain", html: "<p>plain</p>" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_test", "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      from: "Hitstreak <alerts@hitstreak.app>", to: ["u1@example.com"], subject: "Hi", text: "plain", html: "<p>plain</p>",
    });
  });
  it("throws with the status and body on a non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"message":"invalid from"}', { status: 422 }));
    const mailer = createResendMailer({ apiKey: "re_test", from: "x@y.z", fetchImpl });
    await expect(mailer.send({ to: "a@b.c", subject: "s", text: "t", html: "h" })).rejects.toThrow(/Resend 422: .*invalid from/);
  });
});

describe("mailerFromEnv", () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  it("is null unless both RESEND_API_KEY and ALERT_FROM_EMAIL are set", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("ALERT_FROM_EMAIL", "");
    expect(mailerFromEnv()).toBeNull();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    expect(mailerFromEnv()).toBeNull();
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("ALERT_FROM_EMAIL", "alerts@hitstreak.app");
    expect(mailerFromEnv()).toBeNull();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    expect(mailerFromEnv()).not.toBeNull();
  });
});
