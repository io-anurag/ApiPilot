import { StatusBadge } from "../StatusBadge";
import type { ChainPlanSession } from "./useChainPlanSession";

/** Whether the plan's latest edit is saved: Saving…, Not saved while the server refuses it, otherwise Saved. Always text. */
export function SaveStatus({ session }: Readonly<{ session: ChainPlanSession }>) {
  if (session.dirty) return <StatusBadge label="Saving…" tone="info" />;
  if (session.saveFailed) return <StatusBadge label="Not saved" tone="danger" />;
  return <StatusBadge label="Saved" tone="success" />;
}
