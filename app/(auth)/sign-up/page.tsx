import Link from "next/link";
import { redirect } from "next/navigation";
import AuthForm from "../AuthForm";
import { safeNext } from "../safe-next";
import { getSession } from "@/lib/session";

export const metadata = { title: "Create your account — Hitstreak" };

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const { next } = await searchParams;
  const session = await getSession();
  if (session) redirect(safeNext(next));
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-ground px-6 py-12">
      <span className="font-display text-3xl text-ink">Hitstreak</span>
      <h1 className="font-display text-2xl text-ink">Create your account</h1>
      <AuthForm mode="sign-up" next={safeNext(next)} />
      <p className="text-[13px] text-muted">
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </div>
  );
}
