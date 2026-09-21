import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppHeader } from "../../src/components/AppHeader";

describe("AppHeader", () => {
  it("shows a connecting indicator while the health check is pending", () => {
    render(<AppHeader health={null} />);
    expect(screen.getByText("ApiPilot")).toBeInTheDocument();
    expect(screen.getByTestId("connection-status")).toHaveTextContent("Connecting");
  });

  it("shows a connected status once the health check succeeds", () => {
    render(
      <AppHeader
        health={{ ok: true, data: { status: "ok", timestamp: "2026-08-26T12:00:00.000Z" } }}
      />,
    );
    expect(screen.getByTestId("connection-status")).toHaveTextContent("Connected");
  });

  it("shows a disconnected status, as an alert, when the health check fails", () => {
    render(<AppHeader health={{ ok: false, error: "network error" }} />);
    const status = screen.getByTestId("connection-status");
    expect(status).toHaveTextContent("Disconnected");
    expect(status).toHaveAttribute("role", "alert");
  });

  it("truncates the subtitle instead of breaking the layout at narrow widths (spec 027 FR-009)", () => {
    render(<AppHeader health={null} />);
    expect(screen.getByText("API test engineering workspace")).toHaveClass("truncate");
  });
});
