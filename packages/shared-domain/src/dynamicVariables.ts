/**
 * The Postman dynamic variables a performance plan may use, generated at run time by ApiPilot's own
 * runtime code (AP-036 FR-013, amended by AP-037 FR-048). AP-037 (specs/037-request-chain-performance
 * research R5) moved the list here, so the request-chain editor offers and validates the same list the
 * server accepts. Every name needs a deterministic generator in `CHAIN_RUNTIME`
 * (`backend/src/performance/k6/renderChainScript.ts`): a name is added here only together with its
 * generator.
 */
export const SUPPORTED_DYNAMIC_VARIABLES: ReadonlySet<string> = new Set([
  // Common
  "$guid",
  "$randomUUID",
  "$timestamp",
  "$isoTimestamp",
  // Text, numbers and colors
  "$randomInt",
  "$randomAlphaNumeric",
  "$randomBoolean",
  "$randomColor",
  "$randomHexColor",
  "$randomAbbreviation",
  // Internet and IP addresses
  "$randomIP",
  "$randomIPV6",
  "$randomMACAddress",
  "$randomPassword",
  "$randomLocale",
  "$randomUserAgent",
  "$randomProtocol",
  "$randomSemver",
  // Names
  "$randomFirstName",
  "$randomLastName",
  "$randomFullName",
  "$randomNamePrefix",
  "$randomNameSuffix",
  // Profession
  "$randomJobArea",
  "$randomJobDescriptor",
  "$randomJobTitle",
  "$randomJobType",
  // Phone, address and location
  "$randomPhoneNumber",
  "$randomPhoneNumberExt",
  "$randomCity",
  "$randomStreetName",
  "$randomStreetAddress",
  "$randomCountry",
  "$randomCountryCode",
  "$randomLatitude",
  "$randomLongitude",
  // Dates
  "$randomDateFuture",
  "$randomDatePast",
  "$randomDateRecent",
  "$randomWeekday",
  "$randomMonth",
  // Domains, emails and usernames
  "$randomDomainName",
  "$randomDomainSuffix",
  "$randomDomainWord",
  "$randomEmail",
  "$randomExampleEmail",
  "$randomUserName",
  "$randomUrl",
]);
