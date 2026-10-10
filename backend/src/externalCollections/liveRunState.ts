/**
 * What an Import & Run Collection run knows only while it runs (AP-045 research R7): how many
 * requests it will send, the name of the one being sent, and each request's authored path with its
 * `{{variables}}` unresolved. Held in memory with the run, never stored: a poll costs no write, and
 * nothing here can carry a value, since the path is the authored template. A finished run keeps its
 * entry (the newest `MAX_KEPT`), so its latest requests still show their paths.
 */

const MAX_KEPT = 50;

export interface CollectionLiveState {
  plannedTotal: number;
  inFlight: string | null;
  /** Item id to the authored path template. */
  paths: ReadonlyMap<string, string>;
}

const states = new Map<string, CollectionLiveState>();

export function beginCollectionLive(runId: string, plannedTotal: number, paths: ReadonlyMap<string, string>): void {
  states.set(runId, { plannedTotal, inFlight: null, paths });
  while (states.size > MAX_KEPT) {
    const oldest = states.keys().next().value;
    if (oldest === undefined) break;
    states.delete(oldest);
  }
}

export function setCollectionInFlight(runId: string, name: string | null): void {
  const state = states.get(runId);
  if (state) state.inFlight = name;
}

export function collectionLiveStateOf(runId: string): CollectionLiveState | undefined {
  return states.get(runId);
}

/** For tests. */
export function clearCollectionLiveState(): void {
  states.clear();
}
