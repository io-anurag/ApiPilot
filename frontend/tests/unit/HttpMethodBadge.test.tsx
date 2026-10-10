import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HttpMethodBadge } from "../../src/components/HttpMethodBadge";

describe("HttpMethodBadge", () => {
  it.each(["GET", "POST", "PUT", "PATCH", "DELETE"])(
    "renders a distinguishable, text-based treatment for %s",
    (method) => {
      render(<HttpMethodBadge method={method} />);
      expect(screen.getByTestId("http-method-badge")).toHaveTextContent(method);
    },
  );

  it("normalizes method casing", () => {
    render(<HttpMethodBadge method="get" />);
    expect(screen.getByTestId("http-method-badge")).toHaveTextContent("GET");
  });
});

describe("HttpMethodBadge colour", () => {
  it("shows HEAD and OPTIONS in their own colours, distinct from each other", () => {
    const fills = ["HEAD", "OPTIONS"].map((method) => {
      const { unmount } = render(<HttpMethodBadge method={method} />);
      const fill = screen.getByTestId("http-method-badge").className.split(" ").find((cls) => cls.startsWith("bg-"));
      unmount();
      return fill;
    });
    expect(fills[0]).toBe("bg-method-head");
    expect(fills[1]).toBe("bg-method-options");
  });

  it("keeps an unlisted method neutral, with readable text", () => {
    render(<HttpMethodBadge method="TRACE" />);
    expect(screen.getByTestId("http-method-badge")).toHaveClass("bg-surface-strong", "text-text-primary");
  });
});
