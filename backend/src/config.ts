/**
 * Minimal environment configuration loader.
 * Reads process.env directly (populated by the shell, a `.env` file loader in
 * development, or the deployment environment) — no external dependency required.
 */
export interface AppConfig {
  backendPort: number;
}

const DEFAULT_BACKEND_PORT = 4000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawPort = env.BACKEND_PORT;
  const parsedPort = rawPort ? Number.parseInt(rawPort, 10) : DEFAULT_BACKEND_PORT;
  const backendPort =
    Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_BACKEND_PORT;

  return { backendPort };
}
