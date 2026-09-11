export const NAV_ITEMS = [
  { href: "/binders", label: "Binder" },
  { href: "/sets", label: "Sets" },
  { href: "/decks", label: "Decks" },
  { href: "/alerts", label: "Alerts" },
] as const;

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}
