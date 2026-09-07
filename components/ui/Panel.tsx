import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export default function Panel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-panel border border-hairline bg-surface p-4", className)} {...rest} />;
}
