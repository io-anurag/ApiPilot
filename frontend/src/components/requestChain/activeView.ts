import { createContext } from "react";

/**
 * The top-level view on screen (App.tsx): "start", or the active tab. Each entry view stays mounted
 * while hidden, so `SeededPlans` reads this to list the plans again when the user returns to it,
 * after plans were seeded, renamed or deleted elsewhere (specs/037-request-chain-performance US5).
 */
export const ActiveViewContext = createContext<string>("start");
