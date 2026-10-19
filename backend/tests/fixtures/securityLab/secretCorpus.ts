/**
 * AP-057 T007 / SC-009: seeded secrets. Tests put these values into requests, responses, headers,
 * bodies and error text, run the feature end to end, and assert none of them survives in any stored
 * or exported artifact (evidence, observed summaries, retained run rows, findings, logs, reports,
 * exports). The values are fake and unique so a plain substring search is conclusive.
 */

export const SECRET_BEARER_TOKEN = "sl-seed-bearer-7f3a91c2d4e85b60a1c3e9f2";
export const SECRET_API_KEY = "sl-seed-apikey-b4c2e8a1f7d3096e5a2c8b1d";
export const SECRET_BASIC_USER = "sl-seed-user-alice";
export const SECRET_BASIC_PASSWORD = "sl-seed-pass-Zq9!vK2#mT7x";
export const SECRET_COOKIE_VALUE = "sl-seed-cookie-9d8c7b6a5f4e3d2c1b0a";
export const SECRET_PASSWORD_FIELD = "sl-seed-password-field-Hn4$wP8&rL1y";
export const SECRET_JSON_TOKEN = "sl-seed-json-token-e1d2c3b4a5968778695a4b3c";
export const SECRET_ERROR_TEXT = "sl-seed-error-secret-0f1e2d3c4b5a69788796a5b4";
export const SECRET_SHAPED_RESPONSE_FIELD = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzbC1zZWVkLXNoYXBlZCJ9.c2wtc2VlZC1zaGFwZWQtc2ln";

/** Every seeded value, for exhaustive assertions. */
export const ALL_SECRETS: readonly string[] = [
  SECRET_BEARER_TOKEN,
  SECRET_API_KEY,
  SECRET_BASIC_USER,
  SECRET_BASIC_PASSWORD,
  SECRET_COOKIE_VALUE,
  SECRET_PASSWORD_FIELD,
  SECRET_JSON_TOKEN,
  SECRET_ERROR_TEXT,
  SECRET_SHAPED_RESPONSE_FIELD,
];

/** Environment variables a test profile's identities refer to (names only; values come from `ALL_SECRETS`). */
export const SEEDED_ENVIRONMENT_VALUES: Readonly<Record<string, string>> = {
  alice_bearerAuth: SECRET_BEARER_TOKEN,
  alice_apiKeyAuth: SECRET_API_KEY,
  bob_bearerAuth: SECRET_JSON_TOKEN,
  bob_apiKeyAuth: SECRET_COOKIE_VALUE,
};

/** Throws, naming the artifact and the first leaked value, when `text` contains any seeded secret. */
export function assertNoSecrets(artifact: string, text: string, secrets: readonly string[] = ALL_SECRETS): void {
  for (const secret of secrets) {
    if (text.includes(secret)) {
      throw new Error(`Seeded secret leaked into ${artifact}: ${secret.slice(0, 18)}…`);
    }
  }
}

/** The same check over any JSON-serialisable value. */
export function assertNoSecretsIn(artifact: string, value: unknown, secrets: readonly string[] = ALL_SECRETS): void {
  assertNoSecrets(artifact, typeof value === "string" ? value : JSON.stringify(value), secrets);
}
