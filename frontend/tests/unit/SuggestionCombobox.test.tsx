import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SuggestionCombobox } from "../../src/components/SuggestionCombobox";
import { HTTP_REQUEST_HEADERS } from "../../src/components/httpRequestHeaders";

const OPTIONS = [
  { name: "Accept", detail: "Media types" },
  { name: "Accept-Language", detail: "Languages" },
  { name: "Content-Type", detail: "Body type" },
  { name: "X-Accept-Hint", detail: "Contains accept" },
];

function Harness({ initial = "", disabled = false }: Readonly<{ initial?: string; disabled?: boolean }>) {
  const [value, setValue] = useState(initial);
  return (
    <SuggestionCombobox label="Header 1 name" value={value} onChange={setValue} options={OPTIONS} disabled={disabled} />
  );
}

const field = () => screen.getByRole("combobox", { name: "Header 1 name" });
const list = () => within(screen.getByRole("listbox", { name: "Options for Header 1 name" }));

describe("SuggestionCombobox", () => {
  it("opens the whole list from the dropdown button", () => {
    render(<Harness />);
    expect(screen.queryByRole("listbox", { name: /Options/ })).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Show all options for Header 1 name" }));
    expect(list().getAllByRole("option")).toHaveLength(OPTIONS.length);
    expect(field()).toHaveAttribute("aria-expanded", "true");
  });

  it("opens the whole list with ArrowDown on a closed field, even when it already has text", () => {
    render(<Harness initial="Content-Type" />);
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(list().getAllByRole("option")).toHaveLength(OPTIONS.length);
  });

  it("filters as the text is typed, names starting with it first, then names containing it", () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: "accept" } });
    expect(list().getAllByRole("option").map((option) => option.textContent)).toEqual([
      "AcceptMedia types",
      "Accept-LanguageLanguages",
      "X-Accept-HintContains accept",
    ]);
  });

  it("picks with the keyboard (Arrow keys then Enter) and with the mouse", () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: "acc" } });
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(field()).toHaveValue("Accept-Language");
    expect(screen.queryByRole("listbox", { name: /Options/ })).not.toBeInTheDocument();

    fireEvent.change(field(), { target: { value: "content" } });
    fireEvent.mouseDown(list().getByRole("option"));
    expect(field()).toHaveValue("Content-Type");
  });

  it("completes with Tab, but lets Tab move on once the field already holds the suggestion", () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: "content-t" } });
    fireEvent.keyDown(field(), { key: "Tab" });
    expect(field()).toHaveValue("Content-Type");

    fireEvent.change(field(), { target: { value: "Content-Type" } });
    const notPrevented = fireEvent.keyDown(field(), { key: "Tab" });
    expect(notPrevented).toBe(true);
  });

  it("closes on Escape and keeps text that is not in the list", () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: "acc" } });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: /Options/ })).not.toBeInTheDocument();

    fireEvent.change(field(), { target: { value: "X-Custom-Header" } });
    expect(screen.queryByRole("listbox", { name: /Options/ })).not.toBeInTheDocument();
    expect(field()).toHaveValue("X-Custom-Header");
  });

  it("is inert while disabled", () => {
    render(<Harness disabled />);
    expect(field()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Show all options for Header 1 name" })).toBeDisabled();
  });
});

describe("HTTP request header catalog", () => {
  it("lists each header once, in valid header-name form, with a description", () => {
    const names = HTTP_REQUEST_HEADERS.map((header) => header.name);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
    expect(names.every((name) => /^[A-Za-z0-9-]+$/.test(name))).toBe(true);
    expect(HTTP_REQUEST_HEADERS.every((header) => header.detail.length > 0)).toBe(true);
    for (const common of ["Accept", "Authorization", "Content-Type", "Cookie", "User-Agent", "X-API-Key"]) {
      expect(names).toContain(common);
    }
  });
});
