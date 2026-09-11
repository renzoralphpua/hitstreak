import type { ReactNode } from "react";
import { cn } from "./cn";

export default function EmptyState({ title, body, action, className }: { title: string; body?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-3 rounded-panel border border-dashed border-hairline p-6", className)}>
      <h3 className="font-display text-title text-ink">{title}</h3>
      {body && <p className="max-w-prose text-base text-muted">{body}</p>}
      {action}
    </div>
  );
}
