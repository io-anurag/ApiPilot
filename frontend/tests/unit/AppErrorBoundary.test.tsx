import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppErrorBoundary } from "../../src/components/AppErrorBoundary";

function Thrower(): never {
  throw new Error("Objects are not valid as a React child");
}

// React's development build re-dispatches a caught render error on `window`, which jsdom then
// prints as an uncaught error; cancelling the event keeps that expected noise out of test output.
const cancelDevRethrow = (event: ErrorEvent) => event.preventDefault();

describe("AppErrorBoundary", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.addEventListener("error", cancelDevRethrow);
    // React itself reports a caught render error to console.error; silence it and the logger's
    // own console output so the assertion below can pick out the structured entry.
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The logger forwards error entries to the backend, best-effort.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  });

  afterEach(() => {
    window.removeEventListener("error", cancelDevRethrow);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders its children when nothing throws", () => {
    render(
      <AppErrorBoundary>
        <p>Workspace</p>
      </AppErrorBoundary>,
    );
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("replaces a crashed tree with an error message instead of a blank page", () => {
    render(
      <AppErrorBoundary>
        <Thrower />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Something went wrong and this page could not be shown.",
    );
    expect(screen.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
  });

  it("logs the error message once through the structured logger", () => {
    render(
      <AppErrorBoundary>
        <Thrower />
      </AppErrorBoundary>,
    );
    const entries = errorSpy.mock.calls
      .map(([entry]) => entry)
      .filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null && "component" in entry,
      );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "error",
      component: "AppErrorBoundary",
      event: "render_error",
      message: "Objects are not valid as a React child",
    });
  });

  it("reloads the page from the recovery action", () => {
    const onReload = vi.fn();
    render(
      <AppErrorBoundary onReload={onReload}>
        <Thrower />
      </AppErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("shows the error's message under Technical details, and nothing else about the crash", () => {
    render(
      <AppErrorBoundary>
        <Thrower />
      </AppErrorBoundary>,
    );
    expect(screen.getByText("Technical details")).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Objects are not valid as a React child");
    expect(alert).not.toHaveTextContent(/at Thrower|\.tsx/);
  });

  it("copies the message, and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(
      <AppErrorBoundary>
        <Thrower />
      </AppErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Details copied."));
    expect(writeText).toHaveBeenCalledWith("ApiPilot could not show a page. Error: Objects are not valid as a React child");
  });

  it("says when the clipboard refuses, instead of claiming success", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(
      <AppErrorBoundary>
        <Thrower />
      </AppErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Could not copy."));
  });
});
