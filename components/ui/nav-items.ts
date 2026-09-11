export const NAV_ITEMS = [
  { href: "/collections", label: "Collection" },
  { href: "/sets", label: "Sets" },
  { href: "/decks", label: "Decks" },
  { href: "/alerts", label: "Alerts" },
] as const;

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}
