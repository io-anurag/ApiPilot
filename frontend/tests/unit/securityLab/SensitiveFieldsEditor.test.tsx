import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SensitiveFieldsEditor, parseFieldNames } from "../../../src/components/securityLab/SensitiveFieldsEditor";
import * as client from "../../../src/services/securityLabClient";

vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  saveSettings: vi.fn(),
}));

const saveSettings = vi.mocked(client.saveSettings);

beforeEach(() => saveSettings.mockReset());

describe("parseFieldNames", () => {
  it("splits on lines and commas, trims, and drops blanks", () => {
    expect(parseFieldNames(" ssn \n\n iban , card.number,, ")).toEqual(["ssn", "iban", "card.number"]);
    expect(parseFieldNames("")).toEqual([]);
  });
});

describe("SensitiveFieldsEditor (FR-009)", () => {
  it("states that the names are configured by the user and are names only, never values", () => {
    render(<SensitiveFieldsEditor fields={[]} onSaved={vi.fn()} />);
    expect(screen.getByText(/recorded as configured by you, not as part of the\s+specification/)).toBeInTheDocument();
    expect(screen.getByText(/Enter names only, never values/)).toBeInTheDocument();
    expect(screen.getByLabelText("Sensitive field names")).toHaveAccessibleDescription(/names only/i);
  });

  it("starts with the saved names and keeps Save disabled until something changes", () => {
    render(<SensitiveFieldsEditor fields={["ssn", "iban"]} onSaved={vi.fn()} />);
    expect(screen.getByLabelText("Sensitive field names")).toHaveValue("ssn\niban");
    expect(screen.getByRole("button", { name: "Save field names" })).toBeDisabled();
  });

  it("saves the parsed names and reports the list the server stored", async () => {
    saveSettings.mockResolvedValue({ ok: true, data: { sensitiveFields: ["ssn", "iban"] } });
    const onSaved = vi.fn();
    render(<SensitiveFieldsEditor fields={[]} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("Sensitive field names"), { target: { value: "ssn\n iban \n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save field names" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(["ssn", "iban"]));
    expect(saveSettings).toHaveBeenCalledWith(["ssn", "iban"]);
  });

  it("shows the server's reason when a name is refused, and does not claim it saved", async () => {
    saveSettings.mockResolvedValue({ ok: false, error: "invalid_request", message: "'bad name' is not a valid field name.", status: 400, details: {} });
    const onSaved = vi.fn();
    render(<SensitiveFieldsEditor fields={[]} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("Sensitive field names"), { target: { value: "bad name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save field names" }));
    expect(await screen.findByTestId("sensitive-fields-error")).toHaveTextContent("is not a valid field name");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });
});
