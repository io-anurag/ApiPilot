import type { LeakPatternId } from "@apipilot/shared-domain";

/**
 * The fixed enumeration of leak patterns (specs/057 research R6, R15, FR-027, FR-053). A scenario names a pattern by
 * id and can never supply its own: no expression, regular expression or function is accepted from content. Each
 * pattern is a small, linear regular expression written here, over text that comes from an arbitrary target, so none
 * has nested quantifiers or unbounded alternation that could backtrack badly.
 *
 * A match means "this kind of text is present", never "the service is vulnerable": the scenario's wording says so.
 */

const PATTERNS: Readonly<Record<LeakPatternId, readonly RegExp[]>> = {
  "stack-trace": [
    /\bat\s+[\w$.<>[\]]+\s+\([^()\n]{1,200}:\d+:\d+\)/,
    /\bat\s+[\w.$]+\([\w$]+\.java:\d+\)/,
    /\bTraceback \(most recent call last\)/,
    /\bat\s+[\w.]+\.[\w`<>]+\([^)\n]{0,100}\)\s+in\s+\S+:line\s+\d+/,
    /\bat\s+\S+\.go:\d+/,
  ],
  "server-banner": [/\b(?:Apache|nginx|Express|Tomcat|Jetty|IIS|Werkzeug|Kestrel|Gunicorn|Passenger)\/\d+(?:\.\d+){0,3}/i, /\bX-Powered-By:\s*\S+/i],
  "internal-path": [/\b[A-Za-z]:\\(?:[\w.-]+\\){1,20}[\w.-]+/, /(?:^|[\s"'(=:])\/(?:home|usr|var|opt|srv|app|etc|root)\/[\w./-]{2,200}/],
  "secret-shaped-value": [
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/,
    /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/,
    /\bAKIA[A-Z0-9]{16}\b/,
    /-----BEGIN [A-Z ]{0,30}PRIVATE KEY-----/,
  ],
  "sql-error": [
    /\bSQLSTATE\[?[0-9A-Z]{5}/,
    /\bORA-\d{5}\b/,
    /\bsyntax error at or near\b/i,
    /\bYou have an error in your SQL syntax\b/i,
    /\bSQLITE_ERROR\b/,
    /\bunterminated quoted string\b/i,
    /\bunclosed quotation mark\b/i,
    /\bPG::\w+Error\b/,
  ],
};

/** Whether `text` contains the named kind of leak. */
export function matchesLeakPattern(patternId: LeakPatternId, text: string): boolean {
  return PATTERNS[patternId].some((pattern) => pattern.test(text));
}

/** The fixed wording for a pattern, used in observed summaries. Never includes the matched text. */
export const LEAK_PATTERN_LABELS: Readonly<Record<LeakPatternId, string>> = {
  "stack-trace": "a stack trace",
  "server-banner": "a server or framework version banner",
  "internal-path": "an internal file path",
  "secret-shaped-value": "a secret-shaped value",
  "sql-error": "a database error message",
};
