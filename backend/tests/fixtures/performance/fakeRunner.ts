import type {
  PerformanceRunner,
  RunnerExit,
  RunnerHandle,
  RunnerStartInput,
} from "../../../src/performance/k6/runnerTypes";

/**
 * A `PerformanceRunner` that replays metrics lines on `setTimeout`, so tests drive a whole run with
 * fake timers and no k6 (specs/031-k6-performance-testing tasks T005). It records every start
 * input, so tests can assert what the real runner would have been given.
 */
export interface FakeRunnerOptions {
  lines: string[];
  lineIntervalMs?: number;
  exitCode?: number;
  /** Keep the "process" running after the last line until `cancel()` is called. */
  holdUntilCancelled?: boolean;
  spawnError?: RunnerExit["spawnError"];
  /** AP-034: stderr lines delivered when the "process" starts (k6 --log-format json lines). */
  stderrLines?: string[];
}

export interface FakeRunner extends PerformanceRunner {
  starts: RunnerStartInput[];
  cancels: number;
  /** The lines the next `start` replays; settable after creation, once a test knows its step ids. */
  lines: string[];
}

export function createFakeRunner(options: FakeRunnerOptions): FakeRunner {
  const runner: FakeRunner = {
    starts: [],
    cancels: 0,
    lines: options.lines,
    start(input: RunnerStartInput): RunnerHandle {
      runner.starts.push(input);
      if (options.spawnError) {
        return { cancel: () => undefined, done: Promise.resolve({ exitCode: null, cancelled: false, spawnError: options.spawnError }) };
      }
      let resolveDone!: (exit: RunnerExit) => void;
      const done = new Promise<RunnerExit>((resolve) => {
        resolveDone = resolve;
      });
      for (const line of options.stderrLines ?? []) input.onStderrLine(line);
      const lines = runner.lines;
      let index = 0;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (exit: RunnerExit) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolveDone(exit);
      };
      const emitNext = () => {
        if (settled) return;
        if (index < lines.length) {
          input.onLine(lines[index]);
          index += 1;
          timer = setTimeout(emitNext, options.lineIntervalMs ?? 10);
          return;
        }
        if (!options.holdUntilCancelled) settle({ exitCode: options.exitCode ?? 0, cancelled: false });
      };
      timer = setTimeout(emitNext, options.lineIntervalMs ?? 10);
      return {
        cancel: () => {
          runner.cancels += 1;
          settle({ exitCode: null, cancelled: true });
        },
        done,
      };
    },
  };
  return runner;
}
