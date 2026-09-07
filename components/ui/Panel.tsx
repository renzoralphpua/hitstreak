import type { ComponentProps } from "react";
import { cn } from "./cn";

// `ComponentProps<"div">` rather than `HTMLAttributes` so callers can pass a `ref` (React 19
// hands refs to function components as a plain prop) — the add-item dialog traps focus in one.
export default function Panel({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("rounded-panel border border-hairline bg-surface p-4", className)} {...rest} />;
}
