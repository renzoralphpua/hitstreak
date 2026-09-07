"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui";

export default function AuthForm({ mode, next = "/portfolios" }: { mode: "sign-in" | "sign-up"; next?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = mode === "sign-in"
      ? await authClient.signIn.email({ email, password })
      : await authClient.signUp.email({ email, password, name });
    setBusy(false);
    if (res.error) {
      setError(res.error.message ?? "Something went wrong");
      return;
    }
    router.refresh();
    router.push(next);
  }

  const field = "h-11 w-full rounded-tile border border-hairline bg-surface px-3.5 text-ink outline-none focus:border-ink";
  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-3">
      {mode === "sign-up" && (
        <label className="flex flex-col gap-1 text-[13px] text-muted">
          Name
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        </label>
      )}
      <label className="flex flex-col gap-1 text-[13px] text-muted">
        Email
        <input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </label>
      <label className="flex flex-col gap-1 text-[13px] text-muted">
        Password
        <input
          className={field}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
        />
      </label>
      {error && <p role="alert" className="text-[13px] text-accent">{error}</p>}
      <Button type="submit" disabled={busy}>{mode === "sign-in" ? "Sign in" : "Create account"}</Button>
    </form>
  );
}
