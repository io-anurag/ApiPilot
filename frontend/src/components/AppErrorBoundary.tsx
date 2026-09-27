import { Component, type ReactNode } from "react";
import { createLogger } from "../logger";
import { BUTTON_STYLES } from "./controlStyles";
import { ErrorState } from "./ErrorState";

const logger = createLogger("AppErrorBoundary");

interface AppErrorBoundaryProps {
  children: ReactNode;
  /** Overridable so tests can observe the recovery action; jsdom does not implement navigation. */
  onReload?: () => void;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

/**
 * Root-level React error boundary. Without it, an exception thrown while rendering unmounts the
 * whole tree and leaves a blank page; with it, the user sees an explicit error and a recovery
 * action instead. It complements, rather than replaces, `globalErrorHandlers.ts` (specs/020
 * research.md Decision 4): React routes render-phase errors to the nearest boundary, not to the
 * `window` listeners in production, so this is the only place they are logged. Only the error's
 * message is logged — never props, state, or the component stack, which can carry request data.
 *
 * Recovery is a full reload rather than resetting the boundary: re-rendering the same tree with
 * the same state would normally throw the same error again.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    logger.error("render_error", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private readonly handleReload = () => {
    (this.props.onReload ?? (() => window.location.reload()))();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="min-h-screen bg-background text-slate-900 dark:text-slate-100">
        <div className="mx-auto max-w-3xl space-y-3 px-4 py-10 sm:px-6">
          <ErrorState
            testId="app-error-boundary"
            message="Something went wrong and this page could not be shown."
            detail="Reload the page to continue. Your saved collections, environments and run history are not affected."
          />
          <button type="button" className={BUTTON_STYLES.primary} onClick={this.handleReload}>
            Reload page
          </button>
        </div>
      </main>
    );
  }
}
