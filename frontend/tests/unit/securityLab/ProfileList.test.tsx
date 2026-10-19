import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileList } from "../../../src/components/securityLab/ProfileList";
import * as client from "../../../src/services/securityLabClient";
import { profileView } from "./securityFixtures";

vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  checkProfile: vi.fn(),
  deleteProfile: vi.fn(),
}));

const checkProfile = vi.mocked(client.checkProfile);
const deleteProfile = vi.mocked(client.deleteProfile);

const GOOD = profileView({ profile: { id: "p-good", name: "Good profile" } });
const BAD = profileView({
  profile: { id: "p-bad", name: "Bad profile" },
  valid: false,
  environment: { name: "Prod-like", tier: "staging", baseUrl: "https://api.example.test" },
  problems: [{ field: "maxRequests", code: "limit_above_ceiling", message: "'maxRequests' is 5000, above the ceiling of 1000." }],
});
const ORPHAN = profileView({
  profile: { id: "p-orphan", name: "No target" },
  valid: false,
  environment: undefined,
  problems: [{ field: "environmentId", code: "environment_not_found", message: "The target environment this profile points at no longer exists." }],
});

function renderList(profiles = [GOOD, BAD], selectedId: string | null = null) {
  const onSelect = vi.fn();
  const onEdit = vi.fn();
  const onDeleted = vi.fn();
  render(<ProfileList profiles={profiles} selectedId={selectedId} onSelect={onSelect} onEdit={onEdit} onDeleted={onDeleted} />);
  return { onSelect, onEdit, onDeleted };
}

beforeEach(() => {
  checkProfile.mockReset();
  deleteProfile.mockReset();
});

describe("ProfileList (T088, FR-034, FR-040)", () => {
  it("renders a semantic table of profiles with target, validity and credential counts as text", () => {
    renderList();
    const table = screen.getByRole("table", { name: /Security profiles/ });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Profile", "Target", "Validity", "Credentials", "Actions"]);
    const [good, bad] = screen.getAllByTestId("profile-row");
    expect(within(good).getByText("Valid")).toBeInTheDocument();
    expect(within(good).getByText("https://api.example.test")).toBeInTheDocument();
    expect(within(good).getByText("0 of 2 credentials set")).toBeInTheDocument();
    expect(within(bad).getByText("Not valid")).toBeInTheDocument();
  });

  it("shows every problem of an invalid profile by code and text, and says it cannot be used", () => {
    renderList();
    const bad = screen.getAllByTestId("profile-row")[1];
    expect(within(bad).getByRole("list", { name: "Problems with Bad profile" })).toHaveTextContent("limit_above_ceiling (maxRequests): 'maxRequests' is 5000, above the ceiling of 1000.");
    expect(within(bad).getByText("Not available for a run until the problems above are fixed.")).toBeInTheDocument();
    expect(within(bad).getByRole("button", { name: "Use Bad profile for a run" })).toBeDisabled();
  });

  it("says when the target no longer exists", () => {
    renderList([ORPHAN]);
    const row = screen.getByTestId("profile-row");
    expect(within(row).getByText("The target no longer exists")).toBeInTheDocument();
    expect(within(row).getByText(/environment_not_found/)).toBeInTheDocument();
  });

  it("chooses a valid profile for a run and marks the chosen one with text and aria-pressed", () => {
    const { onSelect } = renderList();
    fireEvent.click(screen.getByRole("button", { name: "Use Good profile for a run" }));
    expect(onSelect).toHaveBeenCalledWith("p-good");
  });

  it("marks the chosen profile", () => {
    renderList([GOOD, BAD], "p-good");
    const button = screen.getByRole("button", { name: "Use Good profile for a run" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveTextContent("Chosen");
    expect(screen.getByText("(chosen for the run)")).toBeInTheDocument();
  });

  it("checks a profile, showing that no request is sent and then where a request would go", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof client.checkProfile>>) => void;
    checkProfile.mockReturnValue(new Promise((r) => (resolve = r)));
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "Check Good profile" }));
    expect(await screen.findByRole("status")).toHaveTextContent("No request is sent to the target.");
    resolve({
      ok: true,
      data: {
        valid: true,
        problems: [],
        destination: { host: "api.example.test", port: 443, resolvedClass: "public", connectTo: "93.184.216.34", addresses: [{ address: "93.184.216.34", addressClass: "public", allowed: true }] },
      },
    });
    const result = await screen.findByTestId("profile-check-result");
    expect(result).toHaveTextContent("Check passed: the profile is valid and its destination is allowed.");
    expect(result).toHaveTextContent("api.example.test:443, address class public, a request would connect to 93.184.216.34");
    expect(checkProfile).toHaveBeenCalledWith("p-good");
  });

  it("shows a failed check with the blocked reason and its explanation, never as a pass", async () => {
    checkProfile.mockResolvedValue({
      ok: true,
      data: {
        valid: false,
        problems: [{ field: "environmentId", code: "destination_blocked", message: "A request to this target would be blocked (private_address)." }],
        destination: { host: "intranet.example.test", port: 443, resolvedClass: "private", addresses: [], blockedReason: "private_address", explanation: "The address is private." },
      },
    });
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "Check Good profile" }));
    const result = await screen.findByTestId("profile-check-result");
    expect(result).toHaveTextContent("Check failed: the profile cannot be used as it is.");
    expect(result).toHaveTextContent("Blocked (private_address): The address is private.");
    expect(within(result).getByRole("list", { name: "Problems found by the check" })).toHaveTextContent("destination_blocked (environmentId)");
    expect(result).not.toHaveTextContent("Check passed");
  });

  it("shows a check that could not run as an error", async () => {
    checkProfile.mockResolvedValue({ ok: false, error: "network_error", message: "The Security Lab service is unreachable.", status: 0, details: {} });
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "Check Good profile" }));
    expect(await screen.findByTestId("profile-check-error")).toHaveTextContent("The Security Lab service is unreachable.");
  });

  it("edits a profile", () => {
    const { onEdit } = renderList();
    fireEvent.click(screen.getByRole("button", { name: "Edit Good profile" }));
    expect(onEdit).toHaveBeenCalledWith("p-good");
  });

  it("deletes only after confirmation", async () => {
    deleteProfile.mockResolvedValue({ ok: true, data: {} });
    const { onDeleted } = renderList();
    fireEvent.click(screen.getByRole("button", { name: "Delete Good profile" }));
    let dialog = await screen.findByTestId("confirm-dialog");
    expect(dialog).toHaveTextContent('Delete the profile "Good profile"?');
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(deleteProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete Good profile" }));
    dialog = await screen.findByTestId("confirm-dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete profile (1)" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("p-good"));
    expect(deleteProfile).toHaveBeenCalledWith("p-good");
  });

  it("explains a profile that is in use when it cannot be deleted", async () => {
    deleteProfile.mockResolvedValue({ ok: false, error: "profile_in_use", message: "A run is using this profile. Cancel it or wait for it to finish.", status: 409, details: {} });
    const { onDeleted } = renderList();
    fireEvent.click(screen.getByRole("button", { name: "Delete Good profile" }));
    fireEvent.click(within(await screen.findByTestId("confirm-dialog")).getByRole("button", { name: "Delete profile (1)" }));
    expect(await screen.findByTestId("profile-delete-error")).toHaveTextContent("A run is using this profile.");
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("says there are no profiles yet, as an empty state", () => {
    renderList([]);
    expect(screen.getByTestId("profile-list-empty")).toHaveTextContent("There are no profiles yet.");
  });
});
