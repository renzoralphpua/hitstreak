import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

function req(path: string, cookie?: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers: cookie ? { cookie } : {} });
}

describe("proxy (optimistic auth redirect)", () => {
  it("redirects unauthenticated /portfolios to /sign-in with a next param", async () => {
    const res = await proxy(req("/portfolios"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/sign-in?next=%2Fportfolios");
  });
  it("lets a request with a session cookie through", async () => {
    const res = await proxy(req("/portfolios", "better-auth.session_token=abc"));
    expect(res.headers.get("location")).toBeNull();
  });
  it("carries the current path on the request headers for the layout's real gate", async () => {
    const res = await proxy(req("/portfolios?tab=active", "better-auth.session_token=abc"));
    expect(res.headers.get("x-middleware-request-x-pathname")).toBe("/portfolios?tab=active");
  });
  it("does not touch public routes", async () => {
    const res = await proxy(req("/sign-in"));
    expect(res.headers.get("location")).toBeNull();
  });
  it("leaves public share pages alone", async () => {
    const res = await proxy(req("/s/abcdefghijklmnopqrstuv"));
    expect(res.headers.get("location")).toBeNull();
  });
  it("preserves the query string in the next param", async () => {
    const res = await proxy(req("/cards?q=pika"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/sign-in?next=%2Fcards%3Fq%3Dpika");
  });
});
