// Email delivery for alerts. Resend's REST API over fetch (no SDK); `Mailer` is the seam the
// nightly job and its tests use. `send` THROWS on failure — the caller decides what an
// undelivered alert means (it stays armed and is retried the next night, spec §9).
import { formatMoney } from "@/lib/format";
import type { Direction } from "@/lib/alerts";

export interface Mail { to: string; subject: string; text: string; html: string }
export interface Mailer { send(mail: Mail): Promise<void> }

export function createResendMailer(opts: { apiKey: string; from: string; fetchImpl?: typeof fetch }): Mailer {
  const f = opts.fetchImpl ?? fetch;
  return {
    async send(mail) {
      const res = await f("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: opts.from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}

/** null when Resend isn't configured — the nightly then logs what it WOULD have sent. */
export function mailerFromEnv(): Mailer | null {
  const apiKey = process.env.RESEND_API_KEY, from = process.env.ALERT_FROM_EMAIL;
  return apiKey && from ? createResendMailer({ apiKey, from }) : null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

export interface AlertEmailInput {
  to: string; cardName: string; setName: string; number: string | null; subtype: string;
  direction: Direction; threshold: number; market: number; cardUrl: string;
}

/** Spec §7: card, threshold, current price, link. Plain text first; the HTML is the same words. */
export function alertEmail(i: AlertEmailInput): Mail {
  const verb = i.direction === "above" ? "rose above" : "dropped below";
  const where = [i.setName, i.number, i.subtype].filter(Boolean).join(" · ");
  const subject = `${i.cardName} ${verb} ${formatMoney(i.threshold)} — now ${formatMoney(i.market)}`;
  const text = [
    `${i.cardName} (${where}) ${verb} your ${formatMoney(i.threshold)} line.`,
    `Market price today: ${formatMoney(i.market)}.`,
    ``,
    `View the card: ${i.cardUrl}`,
    ``,
    `This alert will email you again only after the price crosses back over ${formatMoney(i.threshold)}. Manage alerts: ${new URL("/alerts", i.cardUrl).href}`,
  ].join("\n");
  const html = `<p><strong>${esc(i.cardName)}</strong> (${esc(where)}) ${verb} your <strong>${formatMoney(i.threshold)}</strong> line.</p>
<p>Market price today: <strong>${formatMoney(i.market)}</strong>.</p>
<p><a href="${esc(i.cardUrl)}">View the card</a></p>
<p style="color:#6f665a;font-size:13px">This alert will email you again only after the price crosses back over ${formatMoney(i.threshold)}. <a href="${esc(new URL("/alerts", i.cardUrl).href)}">Manage alerts</a></p>`;
  return { to: i.to, subject, text, html };
}
