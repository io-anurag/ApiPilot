/**
 * Hosts whose traffic is analytics or telemetry rather than the API under observation (specs/056
 * FR-019). A host matches when it equals an entry or is a subdomain of one. This list is part of the
 * documented contract (contracts/har-import-rules.md): it is frozen, alphabetized, and a change to it
 * is a change to documented behaviour.
 */
export const ANALYTICS_HOSTS: readonly string[] = Object.freeze([
  "amplitude.com",
  "clarity.ms",
  "datadoghq.com",
  "doubleclick.net",
  "facebook.net",
  "fullstory.com",
  "google-analytics.com",
  "googlesyndication.com",
  "googletagmanager.com",
  "heapanalytics.com",
  "hotjar.com",
  "hotjar.io",
  "intercom.io",
  "mixpanel.com",
  "newrelic.com",
  "nr-data.net",
  "optimizely.com",
  "px.ads.linkedin.com",
  "segment.com",
  "segment.io",
  "sentry.io",
  "snowplowanalytics.com",
]);

/** True when `host` equals, or is a subdomain of, a known analytics or telemetry host. */
export function isAnalyticsHost(host: string): boolean {
  const lower = host.toLowerCase();
  return ANALYTICS_HOSTS.some((entry) => lower === entry || lower.endsWith(`.${entry}`));
}
