import { describe, expect, it } from "vitest";
import type { EnvironmentTier, SecurityProfileInput } from "@apipilot/shared-domain";
import { loadSecurityLabLimits } from "../../../src/securityLab/config";
import { ProfileInvalidError, assertProfileValid, parseProfileInput, validateProfile, type ProfileValidationContext } from "../../../src/securityLab/profiles/profileValidation";
import { allowsRelaxedTls, allowsRestrictedAddresses, isProductionTier, mayPermitDestructive, requiresTargetRetype, tierKind } from "../../../src/securityLab/profiles/tierPolicy";
import { SECRET_BEARER_TOKEN } from "../../fixtures/securityLab/secretCorpus";
import { loadSecurityFixtureModel } from "../../fixtures/securityLab/loadModel";

const CEILINGS = loadSecurityLabLimits({}).ceilings;

function context(tier: EnvironmentTier = "staging", baseUrl = "https://api.example.test", extra: Partial<ProfileValidationContext> = {}): ProfileValidationContext {
  return { environment: { name: "Target", tier, baseUrl }, ceilings: CEILINGS, ...extra };
}

function profile(overrides: Partial<SecurityProfileInput> = {}): SecurityProfileInput {
  return {
    name: "Staging run",
    environmentId: "env-1",
    allowedHosts: ["api.example.test"],
    allowedPorts: [443],
    allowedAddressRanges: [],
    tlsPolicy: "verify",
    identities: [],
    testData: [],
    timeoutMs: 10_000,
    maxRequests: 100,
    maxConcurrency: 1,
    permittedCategories: ["authentication"],
    destructivePermitted: false,
    cleanup: { strategy: "none" },
    ...overrides,
  };
}

const codes = (input: SecurityProfileInput, ctx = context()) => validateProfile(input, ctx).map((violation) => violation.code);

describe("a valid profile", () => {
  it("has no violations, for a staging-like and for a local target", () => {
    expect(validateProfile(profile(), context())).toEqual([]);
    const local = profile({ allowedHosts: ["localhost"], allowedPorts: [3000], allowedAddressRanges: ["127.0.0.1", "::1"], tlsPolicy: "relaxed-local" });
    expect(validateProfile(local, context("local", "http://localhost:3000"))).toEqual([]);
  });
});

describe("tiers (FR-037, FR-038)", () => {
  it("refuses a production environment, with the environment named, on every other setting being valid", () => {
    const violations = validateProfile(profile(), context("production"));
    expect(violations.map((v) => v.code)).toEqual(["production_tier_refused"]);
    expect(violations[0].message).toContain("Target");
  });

  it("classifies the tiers once, for every rule that depends on them", () => {
    expect(["local", "dev", "qa", "staging", "production"].map((tier) => tierKind(tier as EnvironmentTier))).toEqual(["local", "staging-like", "staging-like", "staging-like", "refused"]);
    expect(isProductionTier("production")).toBe(true);
    expect(allowsRestrictedAddresses("local")).toBe(true);
    expect(allowsRelaxedTls("local")).toBe(true);
    for (const tier of ["dev", "qa", "staging", "production"] as EnvironmentTier[]) {
      expect(allowsRestrictedAddresses(tier)).toBe(false);
      expect(allowsRelaxedTls(tier)).toBe(false);
    }
    expect(requiresTargetRetype("staging")).toBe(true);
    expect(requiresTargetRetype("local")).toBe(false);
    expect(mayPermitDestructive("production")).toBe(false);
    expect(mayPermitDestructive("qa")).toBe(true);
  });
});

describe("the base URL must be allowed by the profile's own lists (FR-036)", () => {
  it.each([
    ["a host not in the list", profile({ allowedHosts: ["other.example.test"] })],
    ["a port not in the list", profile({ allowedPorts: [8443] })],
    ["no hosts at all", profile({ allowedHosts: [] })],
    ["no ports at all", profile({ allowedPorts: [] })],
  ])("refuses %s, naming the reason code", (_name, input) => {
    const violations = validateProfile(input, context());
    expect(violations.map((v) => v.code)).toEqual(["base_url_blocked"]);
    expect(violations[0].message).toMatch(/host_not_allowed|port_not_allowed/);
  });

  it("refuses a loopback base URL on a staging-like tier, even when the profile lists it", () => {
    const input = profile({ allowedHosts: ["localhost", "127.0.0.1"], allowedPorts: [3000] });
    expect(validateProfile(input, context("staging", "http://127.0.0.1:3000"))[0]).toMatchObject({ code: "base_url_blocked" });
    expect(validateProfile(input, context("staging", "http://127.0.0.1:3000"))[0].message).toContain("restricted_address_blocked");
  });

  it("refuses a literal-IP base URL that is not listed, and a loopback one that is not allowed by an address range", () => {
    const local = (ranges: string[]) => profile({ allowedHosts: ["127.0.0.1"], allowedPorts: [3000], allowedAddressRanges: ranges });
    expect(validateProfile(local(["127.0.0.1"]), context("local", "http://127.0.0.1:3000"))).toEqual([]);
    expect(codes(local([]), context("local", "http://127.0.0.1:3000"))).toEqual(["base_url_blocked"]);
    expect(codes(profile({ allowedHosts: ["localhost"], allowedPorts: [3000], allowedAddressRanges: ["127.0.0.1"] }), context("local", "http://127.0.0.1:3000"))).toEqual(["base_url_blocked"]);
  });

  it("refuses the metadata address as a base URL on a local profile that names it", () => {
    const input = profile({ allowedHosts: ["169.254.169.254"], allowedPorts: [80], allowedAddressRanges: ["169.254.0.0/16"] });
    expect(validateProfile(input, context("local", "http://169.254.169.254"))[0].message).toContain("metadata_address_blocked");
  });
});

describe("address ranges and TLS are local-only (FR-038, FR-040)", () => {
  it("refuses address ranges on every tier other than local", () => {
    for (const tier of ["dev", "qa", "staging"] as EnvironmentTier[]) {
      expect(codes(profile({ allowedAddressRanges: ["10.0.0.0/8"] }), context(tier))).toContain("address_ranges_local_only");
    }
  });

  it("refuses a malformed range, naming the entry, and accepts an address, a CIDR and an IPv6 range", () => {
    const base = { allowedHosts: ["localhost"], allowedPorts: [3000] };
    const bad = validateProfile(profile({ ...base, allowedAddressRanges: ["127.0.0.1", "10.0.0.0/40", "localhost"] }), context("local", "http://localhost:3000"));
    expect(bad.filter((v) => v.code === "invalid_address_range").map((v) => v.field)).toEqual(["allowedAddressRanges[1]", "allowedAddressRanges[2]"]);
    const good = validateProfile(profile({ ...base, allowedAddressRanges: ["127.0.0.1", "10.0.0.0/8", "fd00::/8", "::1"] }), context("local", "http://localhost:3000"));
    expect(good.filter((v) => v.code === "invalid_address_range")).toEqual([]);
  });

  it("refuses relaxed TLS on every tier other than local, and says so", () => {
    for (const tier of ["dev", "qa", "staging"] as EnvironmentTier[]) {
      expect(codes(profile({ tlsPolicy: "relaxed-local" }), context(tier))).toEqual(["relaxed_tls_local_only"]);
    }
    expect(codes(profile({ tlsPolicy: "relaxed-local" }), context("local"))).toEqual([]);
  });
});

describe("hosts", () => {
  it.each(["https://api.example.test", "api.example.test:443", "*.example.test", "api.example.test/path", "user@api.example.test", "has space.test", "a?b.test"])(
    "refuses %s as an allowed host",
    (host) => {
      const violations = validateProfile(profile({ allowedHosts: ["api.example.test", host] }), context());
      expect(violations.filter((v) => v.code === "allowed_host_invalid").map((v) => v.field)).toEqual(["allowedHosts[1]"]);
    },
  );

  it.each(["api.example.test", "API.Example.Test.", "10.0.0.5", "[::1]", "::1", "bücher.example"])("accepts %s as an allowed host", (host) => {
    const violations = validateProfile(profile({ allowedHosts: ["api.example.test", host] }), context());
    expect(violations.filter((v) => v.code === "allowed_host_invalid")).toEqual([]);
  });
});

describe("limits never exceed the ceilings and are never clamped (FR-042)", () => {
  it.each([
    ["maxRequests", CEILINGS.maxRequests],
    ["maxConcurrency", CEILINGS.maxConcurrency],
    ["timeoutMs", CEILINGS.timeoutMs],
  ] as const)("accepts %s at its ceiling and refuses one above it, naming both numbers", (field, ceiling) => {
    expect(codes(profile({ [field]: ceiling }))).toEqual([]);
    const violations = validateProfile(profile({ [field]: ceiling + 1 }), context());
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ field, code: "limit_above_ceiling" });
    expect(violations[0].message).toContain(String(ceiling + 1));
    expect(violations[0].message).toContain(String(ceiling));
  });

  it("uses the ceilings it is given, so a lower configured ceiling is enforced", () => {
    const low = context("staging", "https://api.example.test", { ceilings: { ...CEILINGS, maxRequests: 10 } });
    expect(codes(profile({ maxRequests: 11 }), low)).toEqual(["limit_above_ceiling"]);
    expect(codes(profile({ maxRequests: 10 }), low)).toEqual([]);
  });

  it("refuses a timeout too short to mean anything", () => {
    expect(codes(profile({ timeoutMs: 50 }))).toEqual(["limit_too_low"]);
  });
});

describe("categories", () => {
  it("refuses an unknown category and a category that cannot be executed, each at its own position", () => {
    const violations = validateProfile(profile({ permittedCategories: ["authentication", "no-such-category", "ssrf-unsafe-consumption", "api-inventory"] }), context());
    const byCode = Object.fromEntries(violations.map((v) => [v.field, v.code]));
    expect(byCode["permittedCategories[1]"]).toBe("unknown_category");
    expect(byCode["permittedCategories[2]"]).toBe("category_not_executable");
    expect(byCode["permittedCategories[3]"]).toBe("category_not_executable");
    expect(byCode["permittedCategories[0]"]).toBeUndefined();
  });

  it("accepts every executable category", () => {
    const all = ["authentication", "authorization", "broken-object-level-authorization", "object-property-authorization", "input-validation", "resource-consumption", "sensitive-data-exposure", "security-misconfiguration", "sensitive-business-flows"];
    expect(codes(profile({ permittedCategories: all }))).toEqual([]);
  });
});

describe("identities and test data", () => {
  it("refuses a duplicate identity name, ignoring case", () => {
    const identities = [{ name: "Alice", role: "owner", credentialSchemes: [] }, { name: "alice", role: "other-user", credentialSchemes: [] }];
    expect(validateProfile(profile({ identities }), context())[0]).toMatchObject({ code: "identity_name_duplicate", field: "identities[1].name" });
  });

  it("checks scheme names against the loaded specification, and not at all when none is loaded", async () => {
    const apiModel = await loadSecurityFixtureModel("sample-api.yaml");
    const identities = [{ name: "alice", role: "owner", credentialSchemes: ["bearerAuth", "madeUp"], expiredCredentialSchemes: ["alsoMadeUp"] }];
    const withModel = validateProfile(profile({ identities }), context("staging", "https://api.example.test", { apiModel }));
    expect(withModel.map((v) => [v.code, v.field])).toEqual([
      ["identity_scheme_unknown", "identities[0].credentialSchemes[1]"],
      ["identity_scheme_unknown", "identities[0].expiredCredentialSchemes[0]"],
    ]);
    expect(validateProfile(profile({ identities }), context())).toEqual([]);
  });

  it("requires test data to name an identity of the profile, and an operation of the specification when one is loaded", async () => {
    const apiModel = await loadSecurityFixtureModel("sample-api.yaml");
    const identities = [{ name: "alice", role: "owner", credentialSchemes: [] }];
    const testData = [
      { ownerIdentity: "alice", parameter: "orderId", value: "1001", operationKey: "GET /orders/{orderId}" },
      { ownerIdentity: "nobody", parameter: "orderId", value: "1002" },
      { ownerIdentity: "ALICE", parameter: "orderId", value: "1003", operationKey: "GET /no/such" },
    ];
    const violations = validateProfile(profile({ identities, testData }), context("staging", "https://api.example.test", { apiModel }));
    expect(violations.map((v) => [v.code, v.field])).toEqual([
      ["test_data_identity_unknown", "testData[1].ownerIdentity"],
      ["test_data_operation_unknown", "testData[2].operationKey"],
    ]);
  });

  it("refuses credential-shaped test data by its value and by its parameter name, without echoing the value", () => {
    const identities = [{ name: "alice", role: "owner", credentialSchemes: [] }];
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2VlZHNlZWRzZWVk";
    const testData = [
      { ownerIdentity: "alice", parameter: "orderId", value: jwt },
      { ownerIdentity: "alice", parameter: "api_key", value: "abc" },
      { ownerIdentity: "alice", parameter: "password", value: SECRET_BEARER_TOKEN },
      { ownerIdentity: "alice", parameter: "orderId", value: "1001" },
    ];
    const violations = validateProfile(profile({ identities, testData }), context());
    expect(violations.map((v) => [v.code, v.field])).toEqual([
      ["test_data_credential_shaped", "testData[0].value"],
      ["test_data_credential_shaped", "testData[1].value"],
      ["test_data_credential_shaped", "testData[2].value"],
    ]);
    const joined = JSON.stringify(violations);
    for (const secret of [jwt, SECRET_BEARER_TOKEN]) expect(joined).not.toContain(secret);
    expect(joined).toMatch(/credentials route/);
  });

  it("allows an ordinary identifier as test data, and the reserved rate-limit threshold", () => {
    const identities = [{ name: "alice", role: "owner", credentialSchemes: [] }];
    const testData = [
      { ownerIdentity: "alice", parameter: "orderId", value: "ord-1001" },
      { ownerIdentity: "alice", parameter: "rate-limit-threshold", value: "30" },
    ];
    expect(validateProfile(profile({ identities, testData }), context())).toEqual([]);
  });
});

describe("every violation is reported, not only the first", () => {
  it("lists a production target, relaxed TLS, ranges and an over-ceiling limit together", () => {
    const violations = validateProfile(profile({ tlsPolicy: "relaxed-local", allowedAddressRanges: ["10.0.0.0/8"], maxRequests: CEILINGS.maxRequests + 1 }), context("production"));
    expect(violations.map((v) => v.code).sort()).toEqual(["address_ranges_local_only", "limit_above_ceiling", "production_tier_refused", "relaxed_tls_local_only"]);
  });

  it("does not modify the input", () => {
    const input = profile({ allowedAddressRanges: ["10.0.0.0/8"] });
    const before = JSON.stringify(input);
    validateProfile(input, context());
    expect(JSON.stringify(input)).toBe(before);
  });

  it("raises ProfileInvalidError carrying the violations and a 422 status, and nothing when valid", () => {
    expect(() => assertProfileValid(profile(), context())).not.toThrow();
    let caught: unknown;
    try {
      assertProfileValid(profile({ tlsPolicy: "relaxed-local" }), context());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProfileInvalidError);
    expect(caught).toMatchObject({ code: "profile_invalid", statusCode: 422 });
    expect((caught as ProfileInvalidError).toBody().violations).toHaveLength(1);
  });
});

describe("parseProfileInput", () => {
  const body = (overrides: Record<string, unknown> = {}) => ({ name: "P", environmentId: "e", allowedHosts: ["a.test"], allowedPorts: [443], ...overrides });

  it("applies the documented defaults for what a profile leaves unset", () => {
    expect(parseProfileInput(body())).toEqual({
      name: "P",
      environmentId: "e",
      allowedHosts: ["a.test"],
      allowedPorts: [443],
      allowedAddressRanges: [],
      tlsPolicy: "verify",
      identities: [],
      testData: [],
      timeoutMs: 10_000,
      maxRequests: 100,
      maxConcurrency: 1,
      permittedCategories: [],
      destructivePermitted: false,
      cleanup: { strategy: "none" },
    });
  });

  it("keeps values it is given, trimming names", () => {
    const parsed = parseProfileInput(
      body({
        name: "  Spaced  ",
        destructivePermitted: true,
        cleanup: { strategy: "delete-created-via-spec", idField: "id" },
        identities: [{ name: "alice", role: "owner", credentialSchemes: ["bearerAuth"], expiredCredentialSchemes: ["bearerAuth"] }],
        testData: [{ ownerIdentity: "alice", parameter: "orderId", value: "1", operationKey: "GET /orders/{orderId}" }],
        timeoutMs: 5000,
        maxRequests: 20,
        maxConcurrency: 2,
      }),
    );
    expect(parsed).toMatchObject({ name: "Spaced", destructivePermitted: true, timeoutMs: 5000, maxRequests: 20, maxConcurrency: 2, cleanup: { strategy: "delete-created-via-spec", idField: "id" } });
    expect(parsed.identities[0].expiredCredentialSchemes).toEqual(["bearerAuth"]);
  });

  it.each([
    ["a non-object body", "text"],
    ["an array body", []],
    ["a missing name", { ...body(), name: undefined }],
    ["a blank name", body({ name: "  " })],
    ["a too-long name", body({ name: "n".repeat(101) })],
    ["a missing environment", { ...body(), environmentId: undefined }],
    ["hosts that are not an array", body({ allowedHosts: "a.test" })],
    ["missing hosts", { ...body(), allowedHosts: undefined }],
    ["a non-integer port", body({ allowedPorts: [80.5] })],
    ["a port out of range", body({ allowedPorts: [70000] })],
    ["a port of zero", body({ allowedPorts: [0] })],
    ["an unknown tls policy", body({ tlsPolicy: "off" })],
    ["a non-boolean destructive flag", body({ destructivePermitted: "yes" })],
    ["a zero limit", body({ maxRequests: 0 })],
    ["a fractional limit", body({ timeoutMs: 1.5 })],
    ["a string limit", body({ maxConcurrency: "2" })],
    ["an unknown cleanup strategy", body({ cleanup: { strategy: "drop-database" } })],
    ["a cleanup with no id field", body({ cleanup: { strategy: "delete-created-via-spec" } })],
    ["an identity without a name", body({ identities: [{ role: "owner" }] })],
    ["an identity name with odd characters", body({ identities: [{ name: "a/b", role: "owner" }] })],
    ["eleven identities", body({ identities: Array.from({ length: 11 }, (_, i) => ({ name: `i${i}`, role: "any" })) })],
    ["test data without a value", body({ testData: [{ ownerIdentity: "a", parameter: "p" }] })],
    ["unknown top-level field", body({ surprise: 1 })],
  ])("refuses %s with invalid_request", (_name, input) => {
    expect(() => parseProfileInput(input)).toThrow(expect.objectContaining({ code: "invalid_request", statusCode: 400 }));
  });

  it("refuses a credential value anywhere in a profile, and points to the credentials route without echoing the value", () => {
    for (const input of [
      body({ identities: [{ name: "alice", role: "owner", credentialSchemes: [], token: SECRET_BEARER_TOKEN }] }),
      body({ identities: [{ name: "alice", role: "owner", credentialSchemes: [], password: SECRET_BEARER_TOKEN }] }),
      body({ credentials: { alice: SECRET_BEARER_TOKEN } }),
      body({ apiKey: SECRET_BEARER_TOKEN }),
    ]) {
      let caught: unknown;
      try {
        parseProfileInput(input);
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ code: "invalid_request" });
      const message = (caught as Error).message;
      expect(message).toMatch(/credentials route/);
      expect(message).not.toContain(SECRET_BEARER_TOKEN);
    }
  });
});
