/**
 * k6's stderr for a user script's run, read as `--log-format json` lines (specs/034-run-user-k6-script
 * FR-029, FR-040; research R13). The script's own `console` output is dropped unread: it can print
 * anything, including values it received. Only k6's own error messages are kept, in memory, up to
 * 2,000 characters, for the run's page when k6 could not run the script. Nothing here is logged.
 */
export const MAX_K6_MESSAGE_CHARS = 2_000;

export interface StderrCounts {
  lines: number;
  consoleLines: number;
  unreadableLines: number;
}

export interface StderrFilter {
  onLine(line: string): void;
  /** k6's error messages, joined by newlines, or null when it printed none. */
  keptErrorText(): string | null;
  counts(): StderrCounts;
}

export function createStderrFilter(): StderrFilter {
  const kept: string[] = [];
  let keptLength = 0;
  const counts: StderrCounts = { lines: 0, consoleLines: 0, unreadableLines: 0 };

  return {
    onLine(line: string) {
      counts.lines += 1;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        counts.unreadableLines += 1;
        return;
      }
      if (typeof parsed !== "object" || parsed === null) {
        counts.unreadableLines += 1;
        return;
      }
      const record = parsed as Record<string, unknown>;
      if (record.source === "console") {
        counts.consoleLines += 1;
        return;
      }
      if ((record.level !== "error" && record.level !== "fatal") || typeof record.msg !== "string") return;
      const remaining = MAX_K6_MESSAGE_CHARS - keptLength - (kept.length > 0 ? 1 : 0);
      if (remaining <= 0) return;
      const message = record.msg.slice(0, remaining);
      kept.push(message);
      keptLength += message.length + (kept.length > 1 ? 1 : 0);
    },
    keptErrorText() {
      return kept.length > 0 ? kept.join("\n") : null;
    },
    counts() {
      return { ...counts };
    },
  };
}
