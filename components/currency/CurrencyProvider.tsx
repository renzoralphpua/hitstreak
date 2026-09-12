"use client";
import { createContext, useContext, type ReactNode } from "react";
import { USD_DISPLAY, type Display } from "@/lib/currency";

/**
 * The display currency, for components that render on the client.
 *
 * Server components read it with `getDisplay()`; this exists so a client component deep in the tree
 * does not have to be handed it through six layers of props. The value is SEEDED FROM THE SERVER, so
 * the first client render agrees with the HTML that was sent and nothing flickers.
 *
 * Defaults to dollars when no provider is above — the public share view has no signed-in reader and
 * therefore no preference to honour.
 */
const DisplayContext = createContext<Display>(USD_DISPLAY);

export function CurrencyProvider({ display, children }: { display: Display; children: ReactNode }) {
  return <DisplayContext.Provider value={display}>{children}</DisplayContext.Provider>;
}

export const useDisplay = (): Display => useContext(DisplayContext);
