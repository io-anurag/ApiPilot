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
