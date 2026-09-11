"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button, Input } from "@/components/ui";

export default function AuthForm({ mode, next = "/binders" }: { mode: "sign-in" | "sign-up"; next?: string }) {
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
    try {
      const res = mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name });
      if (res.error) {
        setError(res.error.message ?? "Something went wrong");
        return;
      }
      router.refresh();
      router.push(next);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-3">
      {mode === "sign-up" && (
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
      )}
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
      />
      <Input
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={8}
        autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
      />
      {error && <p role="alert" className="text-base text-accent">{error}</p>}
      <Button type="submit" disabled={busy}>{mode === "sign-in" ? "Sign in" : "Create account"}</Button>
    </form>
  );
}
