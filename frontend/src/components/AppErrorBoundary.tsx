import { Component, type ReactNode } from "react";
import { createLogger } from "../logger";
import { BUTTON_STYLES } from "./controlStyles";

const logger = createLogger("AppErrorBoundary");

interface AppErrorBoundaryProps {
  children: ReactNode;
  /** Overridable so tests can observe the recovery action; jsdom does not implement navigation. */
  onReload?: () => void;
}

type CopyState = "idle" | "copied" | "failed";

interface AppErrorBoundaryState {
  hasError: boolean;
  /** The error's message only, as logged: never props, state or the component stack. */
  message: string;
  copy: CopyState;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Root-level React error boundary. Without it, an exception thrown while rendering unmounts the
 * whole tree and leaves a blank page; with it, the user sees an explicit error and a recovery
 * action instead. It complements, rather than replaces, `globalErrorHandlers.ts` (specs/020
 * research.md Decision 4): React routes render-phase errors to the nearest boundary, not to the
 * `window` listeners in production, so this is the only place they are logged. Only the error's
 * message is logged, shown and copied: never props, state, or the component stack, which can carry
 * request data.
 *
 * The screen does not depend on the app's header, theme switch or any other part of the tree that
 * may be what failed. Recovery is a full reload rather than resetting the boundary: re-rendering the
 * same tree with the same state would normally throw the same error again.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, message: "", copy: "idle" };

  static getDerivedStateFromError(error: unknown): Partial<AppErrorBoundaryState> {
    return { hasError: true, message: messageOf(error) };
  }

  componentDidCatch(error: unknown): void {
    logger.error("render_error", { message: messageOf(error) });
  }

  private readonly handleReload = () => {
    (this.props.onReload ?? (() => window.location.reload()))();
  };

  private readonly handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`ApiPilot could not show a page. Error: ${this.state.message}`);
      this.setState({ copy: "copied" });
    } catch {
      // Clipboard access can be refused (an insecure context, a denied permission); say so, and the
      // details stay selectable on screen.
      this.setState({ copy: "failed" });
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    const { message, copy } = this.state;

    return (
      <main className="grid min-h-screen place-items-center bg-background px-4 py-10 text-slate-900 dark:text-slate-100">
        <section
          role="alert"
          data-testid="app-error-boundary"
          aria-labelledby="app-error-title"
          className="w-full max-w-xl space-y-5 rounded-lg border border-border bg-surface p-6 shadow-sm sm:p-8"
        >
          <div className="flex items-center gap-3">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-100">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                <path d="M12 9v4M12 17h.01" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">ApiPilot</p>
              <h1 id="app-error-title" className="text-lg font-semibold text-balance">
                Something went wrong and this page could not be shown.
              </h1>
            </div>
          </div>

          <p className="text-sm text-muted">Reload the page to continue. Your saved collections, environments and run history are not affected.</p>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BUTTON_STYLES.primary} onClick={this.handleReload}>
              Reload page
            </button>
            <button type="button" className={BUTTON_STYLES.secondary} onClick={() => void this.handleCopy()}>
              Copy details
            </button>
            <span role="status" className="text-xs text-muted">
              {copy === "copied" && "Details copied."}
              {copy === "failed" && "Could not copy. Select the details below instead."}
            </span>
          </div>

          <details className="rounded-md border border-border text-sm">
            <summary className="cursor-pointer rounded-md px-3 py-2 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">Technical details</summary>
            <div className="space-y-2 border-t border-border px-3 py-3">
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-slate-100 p-2 font-mono text-xs dark:bg-white/10">{message}</pre>
              <p className="text-xs text-muted">This message is recorded in the backend log. If the page fails again after a reload, report it with this message.</p>
            </div>
          </details>
        </section>
      </main>
    );
  }
}
