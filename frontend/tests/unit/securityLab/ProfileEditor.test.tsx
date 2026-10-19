import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileEditor } from "../../../src/components/securityLab/ProfileEditor";
import * as client from "../../../src/services/securityLabClient";
import { CATEGORIES, profileView, targetEnvironment } from "./securityFixtures";

vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
  createEnvironment: vi.fn(),
  setCredential: vi.fn(),
  fetchCredentialStatus: vi.fn(),
}));

const createProfile = vi.mocked(client.createProfile);
const updateProfile = vi.mocked(client.updateProfile);
const createEnvironment = vi.mocked(client.createEnvironment);
const setCredential = vi.mocked(client.setCredential);
const fetchCredentialStatus = vi.mocked(client.fetchCredentialStatus);

const SECRET = "s3cr3t-token-value-0123456789";
const STAGING = targetEnvironment();
const LOCAL = targetEnvironment({ id: "env-2", name: "Local dev", tier: "local", baseUrl: "http://127.0.0.1:3000" });

function renderEditor(props: Partial<React.ComponentProps<typeof ProfileEditor>> = {}) {
  const onChanged = vi.fn();
  const onClose = vi.fn();
  const onEnvironmentCreated = vi.fn();
  render(<ProfileEditor environments={[STAGING, LOCAL]} categories={CATEGORIES} onChanged={onChanged} onClose={onClose} onEnvironmentCreated={onEnvironmentCreated} {...props} />);
  return { onChanged, onClose, onEnvironmentCreated };
}

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

function fillMinimal() {
  type("Profile name", "My profile");
  type("Target environment", "env-1");
  type(/Allowed hosts/, "api.example.test");
  type(/Allowed ports/, "443");
}

beforeEach(() => {
  for (const mock of [createProfile, updateProfile, createEnvironment, setCredential, fetchCredentialStatus]) mock.mockReset();
});

describe("ProfileEditor (T087, FR-034 to FR-040)", () => {
  it("starts a new profile from the documented default limits", () => {
    renderEditor();
    expect(screen.getByRole("form", { name: "New profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("Most requests per run")).toHaveValue(100);
    expect(screen.getByLabelText("Most requests at once")).toHaveValue(1);
    expect(screen.getByLabelText("Timeout per request (milliseconds)")).toHaveValue(10000);
    expect(screen.getByLabelText("Permit destructive scenarios (each is still confirmed by name before a run)")).not.toBeChecked();
  });

  it("offers only the categories that can run", () => {
    renderEditor();
    const group = screen.getByRole("group", { name: "Permitted categories" });
    expect(within(group).getAllByRole("checkbox").map((box) => (box as HTMLInputElement).labels?.[0]?.textContent)).toEqual(["Authentication", "Input validation"]);
  });

  it("offers address ranges and relaxed TLS for a local target only", () => {
    renderEditor();
    type("Target environment", "env-1");
    expect(screen.queryByLabelText(/Allowed address ranges/)).not.toBeInTheDocument();
    expect(screen.getByTestId("ranges-local-only")).toHaveTextContent("Address ranges are offered for a local target only.");
    expect(within(screen.getByLabelText("Certificate verification (TLS)")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Verify certificates"]);

    type("Target environment", "env-2");
    expect(screen.getByLabelText(/Allowed address ranges \(local target only\)/)).toBeInTheDocument();
    expect(screen.queryByTestId("ranges-local-only")).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("Certificate verification (TLS)")).getAllByRole("option")).toHaveLength(2);
  });

  it("does not send address ranges or relaxed TLS after the target changes from local to a non-local tier", async () => {
    createProfile.mockResolvedValue({ ok: true, data: profileView() });
    renderEditor();
    type("Profile name", "P");
    type("Target environment", "env-2");
    type(/Allowed hosts/, "127.0.0.1");
    type(/Allowed ports/, "3000");
    type(/Allowed address ranges/, "127.0.0.1");
    type("Certificate verification (TLS)", "relaxed-local");
    type("Target environment", "env-1");
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(createProfile).toHaveBeenCalled());
    expect(createProfile.mock.calls[0][0]).toMatchObject({ allowedAddressRanges: [], tlsPolicy: "verify" });
  });

  it("creates a target with a name, a tier and a base URL only, and chooses it", async () => {
    const created = targetEnvironment({ id: "env-9", name: "QA box", tier: "qa", baseUrl: "https://qa.example.test" });
    createEnvironment.mockResolvedValue({ ok: true, data: { environment: created } });
    const { onEnvironmentCreated } = renderEditor({ environments: [] });
    fireEvent.click(screen.getByRole("button", { name: "Create a new target" }));
    const group = screen.getByRole("group", { name: "New target" });
    fireEvent.change(within(group).getByLabelText("Target name"), { target: { value: "  QA box " } });
    fireEvent.change(within(group).getByLabelText("Tier"), { target: { value: "qa" } });
    fireEvent.change(within(group).getByLabelText(/Base URL/), { target: { value: " https://qa.example.test " } });
    // Production is never offered.
    expect(within(within(group).getByLabelText("Tier")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Local", "Dev", "QA", "Staging"]);
    fireEvent.click(within(group).getByRole("button", { name: "Create target" }));
    await waitFor(() => expect(onEnvironmentCreated).toHaveBeenCalledWith(created));
    expect(createEnvironment).toHaveBeenCalledWith({ name: "QA box", tier: "qa", baseUrl: "https://qa.example.test" });
    expect(screen.queryByRole("group", { name: "New target" })).not.toBeInTheDocument();
  });

  it("shows why a target was not created", async () => {
    createEnvironment.mockResolvedValue({ ok: false, error: "invalid_request", message: "'baseUrl' must not contain credentials.", status: 400, details: {} });
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Create a new target" }));
    fireEvent.click(screen.getByRole("button", { name: "Create target" }));
    expect(await screen.findByTestId("target-error")).toHaveTextContent("'baseUrl' must not contain credentials.");
  });

  it("saves the profile as typed and says it is saved", async () => {
    createProfile.mockResolvedValue({ ok: true, data: profileView() });
    const { onChanged } = renderEditor();
    fillMinimal();
    fireEvent.click(within(screen.getByRole("group", { name: "Permitted categories" })).getByLabelText("Authentication"));
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(createProfile).toHaveBeenCalledWith({
      name: "My profile",
      environmentId: "env-1",
      allowedHosts: ["api.example.test"],
      allowedPorts: [443],
      allowedAddressRanges: [],
      tlsPolicy: "verify",
      identities: [],
      testData: [],
      timeoutMs: 10000,
      maxRequests: 100,
      maxConcurrency: 1,
      permittedCategories: ["authentication"],
      destructivePermitted: false,
      cleanup: { strategy: "none" },
    });
    expect(await screen.findByText(/^Saved\./)).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Edit profile" })).toBeInTheDocument();
  });

  it("shows every server violation by its code, field and sentence", async () => {
    createProfile.mockResolvedValue({
      ok: false,
      error: "profile_invalid",
      message: "The profile is not valid.",
      status: 422,
      details: {
        violations: [
          { field: "maxRequests", code: "limit_above_ceiling", message: "'maxRequests' is 5000, above the ceiling of 1000. Lower it; it is never clamped silently." },
          { field: "tlsPolicy", code: "relaxed_tls_local_only", message: "Relaxed certificate verification is accepted only for a local target." },
        ],
      },
    });
    renderEditor();
    fillMinimal();
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    const error = await screen.findByTestId("profile-error");
    expect(error).toHaveTextContent("The profile is not valid. Fix each listed problem and save again.");
    expect(within(error).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "limit_above_ceiling (maxRequests): 'maxRequests' is 5000, above the ceiling of 1000. Lower it; it is never clamped silently.",
      "relaxed_tls_local_only (tlsPolicy): Relaxed certificate verification is accepted only for a local target.",
    ]);
    expect(screen.queryByText(/^Saved\./)).not.toBeInTheDocument();
  });

  it("names a port it cannot read and sends nothing", async () => {
    renderEditor();
    fillMinimal();
    type(/Allowed ports/, "443, https");
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByTestId("profile-error")).toHaveTextContent("allowedPorts: These are not port numbers: https.");
    expect(createProfile).not.toHaveBeenCalled();
  });

  it("shows another refusal as a message", async () => {
    createProfile.mockResolvedValue({ ok: false, error: "invalid_request", message: "'name' must be a non-empty string.", status: 400, details: {} });
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByTestId("profile-error")).toHaveTextContent("'name' must be a non-empty string.");
  });

  it("edits a saved profile, prefilled, with an update", async () => {
    const view = profileView({ profile: { id: "p-7", name: "Existing", allowedPorts: [443, 8443], maxConcurrency: 3 } });
    updateProfile.mockResolvedValue({ ok: true, data: view });
    renderEditor({ initial: view });
    expect(screen.getByRole("form", { name: "Edit profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("Profile name")).toHaveValue("Existing");
    expect(screen.getByLabelText(/Allowed ports/)).toHaveValue("443, 8443");
    expect(screen.getByLabelText("Most requests at once")).toHaveValue(3);
    type("Profile name", "Renamed");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateProfile).toHaveBeenCalled());
    expect(updateProfile.mock.calls[0][0]).toBe("p-7");
    expect(updateProfile.mock.calls[0][1]).toMatchObject({ name: "Renamed", allowedPorts: [443, 8443], maxConcurrency: 3 });
    expect(createProfile).not.toHaveBeenCalled();
  });

  it("adds, edits and removes an identity and test data, offering only the identities that exist", async () => {
    createProfile.mockResolvedValue({ ok: true, data: profileView() });
    renderEditor();
    fillMinimal();
    fireEvent.click(screen.getByRole("button", { name: "Add an identity" }));
    const identity = screen.getByTestId("identity-editor");
    fireEvent.change(within(identity).getByLabelText(/Identity name/), { target: { value: "alice" } });
    fireEvent.change(within(identity).getByLabelText(/^Role/), { target: { value: "owner" } });
    fireEvent.change(within(identity).getByLabelText(/active credential/), { target: { value: "bearerAuth" } });
    fireEvent.click(screen.getByRole("button", { name: "Add test data" }));
    const row = screen.getByRole("group", { name: "Test data 1" });
    expect(within(within(row).getByLabelText("Owned by identity")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose an identity", "alice"]);
    fireEvent.change(within(row).getByLabelText("Owned by identity"), { target: { value: "alice" } });
    fireEvent.change(within(row).getByLabelText("Parameter"), { target: { value: "orderId" } });
    fireEvent.change(within(row).getByLabelText("Value"), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(createProfile).toHaveBeenCalled());
    expect(createProfile.mock.calls[0][0]).toMatchObject({
      identities: [{ name: "alice", role: "owner", credentialSchemes: ["bearerAuth"] }],
      testData: [{ ownerIdentity: "alice", parameter: "orderId", value: "42" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove test data 1" }));
    expect(screen.queryByRole("group", { name: "Test data 1" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove alice" }));
    expect(screen.queryByTestId("identity-editor")).not.toBeInTheDocument();
  });

  it("offers cleanup by id field only when delete-based cleanup is chosen", () => {
    renderEditor();
    expect(screen.queryByLabelText(/Response field holding the id/)).not.toBeInTheDocument();
    type("Cleanup after a run", "delete-created-via-spec");
    expect(screen.getByLabelText(/Response field holding the id/)).toBeInTheDocument();
  });

  it("closes without saving", () => {
    const { onClose } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    expect(createProfile).not.toHaveBeenCalled();
  });
});

describe("IdentityEditor credentials (T087, FR-038, FR-048)", () => {
  const saved = () =>
    profileView({
      profile: { id: "p-1", identities: [{ name: "alice", role: "owner", credentialSchemes: ["bearerAuth"], expiredCredentialSchemes: ["bearerAuth"] }] },
      credentialStatus: [
        { identity: "alice", scheme: "bearerAuth", kind: "active", set: false },
        { identity: "alice", scheme: "bearerAuth", kind: "expired", set: true },
      ],
    });

  it("offers no credential field before the profile is saved, and says to save it", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add an identity" }));
    fireEvent.change(screen.getByLabelText(/active credential/), { target: { value: "bearerAuth" } });
    expect(screen.getByTestId("credential-pending")).toHaveTextContent("save the profile with this scheme to set it");
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("shows only whether each credential is set, as text, and never a value, in a password field", () => {
    renderEditor({ initial: saved() });
    const rows = screen.getAllByTestId("credential-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Not set")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Set")).toBeInTheDocument();
    for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'))) {
      expect(input.value).toBe("");
      expect(input.autocomplete).toBe("new-password");
    }
    expect(within(rows[0]).getByRole("button", { name: "Clear credential" })).toBeDisabled();
    expect(within(rows[1]).getByRole("button", { name: "Clear credential" })).toBeEnabled();
    expect(within(rows[0]).getByRole("button", { name: "Save credential" })).toBeDisabled();
  });

  it("sends the value once, empties the field the moment it is saved, and reads the status back", async () => {
    setCredential.mockResolvedValue({ ok: true, data: {} });
    fetchCredentialStatus.mockResolvedValue({
      ok: true,
      data: { credentialStatus: [{ identity: "alice", scheme: "bearerAuth", kind: "active", set: true }, { identity: "alice", scheme: "bearerAuth", kind: "expired", set: true }] },
    });
    const { onChanged } = renderEditor({ initial: saved() });
    const row = screen.getAllByTestId("credential-row")[0];
    const field = within(row).getByLabelText("New active value for bearerAuth (write-only)") as HTMLInputElement;
    expect(field.type).toBe("password");
    fireEvent.change(field, { target: { value: SECRET } });
    expect(document.body.textContent).not.toContain(SECRET);
    fireEvent.click(within(row).getByRole("button", { name: "Save credential" }));
    await waitFor(() => expect(within(screen.getAllByTestId("credential-row")[0]).getByText("Set")).toBeInTheDocument());
    expect(setCredential).toHaveBeenCalledWith("p-1", { identity: "alice", scheme: "bearerAuth", kind: "active", value: SECRET });
    expect(fetchCredentialStatus).toHaveBeenCalledWith("p-1");
    expect((screen.getAllByTestId("credential-row")[0].querySelector("input") as HTMLInputElement).value).toBe("");
    expect(document.body.textContent).not.toContain(SECRET);
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(onChanged).toHaveBeenCalled();
    expect(within(screen.getAllByTestId("credential-row")[0]).getByRole("status")).toHaveTextContent("Saved. The value was sent to the server and is no longer held here.");
  });

  it("clears a credential by sending an empty value", async () => {
    setCredential.mockResolvedValue({ ok: true, data: {} });
    fetchCredentialStatus.mockResolvedValue({ ok: true, data: { credentialStatus: [{ identity: "alice", scheme: "bearerAuth", kind: "active", set: false }, { identity: "alice", scheme: "bearerAuth", kind: "expired", set: false }] } });
    renderEditor({ initial: saved() });
    fireEvent.click(within(screen.getAllByTestId("credential-row")[1]).getByRole("button", { name: "Clear credential" }));
    await waitFor(() => expect(setCredential).toHaveBeenCalledWith("p-1", { identity: "alice", scheme: "bearerAuth", kind: "expired", value: "" }));
    await waitFor(() => expect(within(screen.getAllByTestId("credential-row")[1]).getByText("Not set")).toBeInTheDocument());
  });

  it("shows a refused credential as an error and still never shows the value", async () => {
    setCredential.mockResolvedValue({ ok: false, error: "profile_invalid", message: "The profile is not valid.", status: 422, details: {} });
    renderEditor({ initial: saved() });
    const row = screen.getAllByTestId("credential-row")[0];
    fireEvent.change(within(row).getByLabelText(/New active value/), { target: { value: SECRET } });
    fireEvent.click(within(row).getByRole("button", { name: "Save credential" }));
    expect(await within(row).findByRole("alert")).toHaveTextContent("The credential was not saved: The profile is not valid.");
    expect(document.body.textContent).not.toContain(SECRET);
    expect(fetchCredentialStatus).not.toHaveBeenCalled();
  });

  it("does not include a credential value in a profile save", async () => {
    updateProfile.mockResolvedValue({ ok: true, data: saved() });
    renderEditor({ initial: saved() });
    const row = screen.getAllByTestId("credential-row")[0];
    fireEvent.change(within(row).getByLabelText(/New active value/), { target: { value: SECRET } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateProfile).toHaveBeenCalled());
    expect(JSON.stringify(updateProfile.mock.calls[0][1])).not.toContain(SECRET);
  });
});
