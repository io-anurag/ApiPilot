/**
 * Minimal environment configuration loader.
 * Reads process.env directly (populated by the shell, a `.env` file loader in
 * development, or the deployment environment) — no external dependency required.
 */
export interface AppConfig {
  backendPort: number;
  /** Interface the HTTP listener binds to. Loopback unless `BACKEND_HOST` is set explicitly. */
  backendHost: string;
  debugLogRealClientIp: boolean;
}

export class InvalidAIConfigurationError extends Error {
  constructor(variable: string) {
    super(`${variable} must be a positive finite number when provided.`);
    this.name = "InvalidAIConfigurationError";
  }
}

const DEFAULT_BACKEND_PORT = 4000;
const DEFAULT_BACKEND_HOST = "127.0.0.1";

/**
 * Reads `BACKEND_PORT` from `env` (defaulting to `process.env`), falling back to 4000 when
 * unset, non-numeric, or non-positive. Reads `BACKEND_HOST` (default 127.0.0.1, so the server is
 * reachable only from this machine) and `DEBUG_LOG_REAL_CLIENT_IP` (default false) — see
 * `AppConfig.debugLogRealClientIp`.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawPort = env.BACKEND_PORT;
  const parsedPort = rawPort ? Number.parseInt(rawPort, 10) : DEFAULT_BACKEND_PORT;
  const backendPort =
    Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_BACKEND_PORT;
  const backendHost = env.BACKEND_HOST?.trim() || DEFAULT_BACKEND_HOST;
  const debugLogRealClientIp = env.DEBUG_LOG_REAL_CLIENT_IP === "true";

  return { backendPort, backendHost, debugLogRealClientIp };
}

/** Validates AI settings that must fail fast when the backend is started. */
export function validateAIConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  const rawBudget = env.AI_ENHANCEMENT_RUN_BUDGET_MS;
  if (rawBudget === undefined || rawBudget.trim() === "") return;
  const budget = Number(rawBudget);
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new InvalidAIConfigurationError("AI_ENHANCEMENT_RUN_BUDGET_MS");
  }
}
