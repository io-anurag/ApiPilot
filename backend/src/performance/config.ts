/**
 * AP-029 configuration (specs/031-k6-performance-testing research D22), mirroring
 * `persistence/config.ts`: read from the environment with no library, no required value.
 */

/** Reads the optional `K6_BINARY_PATH`. `undefined` means "use the first k6 on PATH". */
export function resolveK6BinaryPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.K6_BINARY_PATH?.trim();
  return raw ? raw : undefined;
}

/** The binary name looked up on PATH when `K6_BINARY_PATH` is unset. */
export function defaultK6BinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "k6.exe" : "k6";
}
