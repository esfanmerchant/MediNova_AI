"use client";

import { createContext } from "react";

/**
 * True inside the administration console. The shell sets it, and the shared
 * components read it to wear the console's surface — the console's buttons,
 * cards, fields and its own line icons — so the pieces the console borrows from
 * the portals (the payment queue, the invoice ledger, the audit panel) match
 * the console's own without the portals changing at all.
 *
 * Its own module, rather than in `ui.tsx`, so `Icon` can read it without the
 * two importing each other.
 */
export const ConsoleSurface = createContext(false);
