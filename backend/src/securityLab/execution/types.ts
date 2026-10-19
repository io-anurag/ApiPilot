import type { AddressClass, EvidenceErrorCategory, TlsPolicy } from "@apipilot/shared-domain";
import type { DestinationPolicy } from "./destinationPolicy";

/**
 * The seam between the run service and the network (specs/057 research R10). The run service builds every
 * request itself and hands it to a `Sender`; the production sender is `guardedSender.ts`, and tests inject a fake
 * one, so `npm test` never reaches a public network (constitution XXI).
 */

export interface OutboundRequest {
  readonly method: string;
  /** Absolute. Built from the profile's base URL and the operation's path, never from scenario content. */
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface SendOptions {
  readonly policy: DestinationPolicy;
  readonly tlsPolicy: TlsPolicy;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /**
   * Called before each **redirect hop** is sent, because every hop counts against the budget. The first request is
   * reserved by the caller. Returns false when the budget is exhausted, which blocks the hop.
   */
  readonly reserveHop: () => boolean;
}

export interface DestinationRecord {
  readonly host: string;
  readonly port: number;
  readonly addressClass?: AddressClass;
  readonly verdict: "allowed" | "blocked";
  readonly reason?: string;
}

export interface RedirectRecord {
  /** Origin and path only: the query, fragment and userinfo are dropped so no secret can ride along. */
  readonly to: string;
  readonly verdict: "followed" | "blocked";
  readonly reason?: string;
}

/** Everything one send observed. A sender never throws: a failure is an `error` category. */
export interface SendOutcome {
  readonly status?: number;
  /** Lowercase names. A repeated header is joined with ", ". */
  readonly headers: Readonly<Record<string, string>>;
  /** Decoded, and at most the response read cap. */
  readonly bodyText: string;
  readonly truncated: boolean;
  readonly durationMs: number;
  /** The destination of the **first** hop. */
  readonly destination: DestinationRecord;
  readonly redirects: readonly RedirectRecord[];
  /** Requests actually put on the wire: 1 plus the redirect hops followed. */
  readonly requestsSent: number;
  readonly error?: { readonly category: EvidenceErrorCategory };
}

export interface Sender {
  send(request: OutboundRequest, options: SendOptions): Promise<SendOutcome>;
}

/** Resolves every address a name maps to. Injected so rebinding can be simulated. */
export type AddressResolver = (hostname: string) => Promise<string[]>;
