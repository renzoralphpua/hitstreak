import Icon from "./Icon";
import { cn } from "./cn";

export type ValidationItem = { ok: boolean; text: string };

const Check = () => <Icon name="check" />;
const Warn = () => <Icon name="warning" />;

export default function ValidationList({ items, className }: { items: ValidationItem[]; className?: string }) {
  return (
    <ul className={cn("flex flex-col gap-2 text-caption", className)}>
      {items.map((it, i) => (
        <li key={i} data-ok={String(it.ok)} className={cn("flex items-start gap-2", it.ok ? "text-muted" : "text-ink")}>
          <span className={cn("mt-px shrink-0", it.ok ? "text-gain" : "text-accent")}>{it.ok ? <Check /> : <Warn />}</span>
          <span>{it.text}</span>
        </li>
      ))}
    </ul>
  );
}
