/**
 * The dynamic variables (`{{$guid}}`, `{{$randomEmail}}`, ...) of a Debug run
 * (specs/039-chain-debug-run research R2). A deliberate twin of `dynamicValue` in `CHAIN_RUNTIME`
 * (`backend/src/performance/k6/renderChainScript.ts`): the k6 runtime is a fixed text and cannot be
 * imported, so the word lists and the generator are repeated here, and
 * `backend/tests/unit/performance/chain/debugParity.test.ts` runs both over the same inputs so they
 * cannot drift apart unseen. Pure: the clock, the virtual user, the iteration and the run tag are
 * inputs, so a test controls every value.
 */

export interface DynamicContext {
  /** `__VU`: 0 in the setup phase, 1 for the first virtual user. */
  vu: number;
  /** `__ITER`: 0 for the first iteration. */
  iteration: number;
  /** The run's 6 hex characters, or "" when there is none. */
  runTag: string;
  /** Milliseconds since the epoch, for the timestamp and date values. */
  nowMs: () => number;
}

const FIRST_NAMES = ["Ada", "Alan", "Barbara", "Claude", "Dennis", "Donald", "Edsger", "Frances", "Grace", "Hedy", "Ivan", "Jean", "Ken", "Katherine", "Leslie", "Linus", "Margaret", "Niklaus", "Radia", "Rosalind", "Sophie", "Tim", "Vint", "Whitfield"];
const LAST_NAMES = ["Allen", "Babbage", "Backus", "Berners", "Cerf", "Diffie", "Dijkstra", "Engelbart", "Hamilton", "Hopper", "Johnson", "Kahn", "Knuth", "Lamarr", "Lamport", "Liskov", "Lovelace", "Perlman", "Ritchie", "Shannon", "Sutherland", "Thompson", "Turing", "Wirth"];
const ALPHANUMERIC = "0123456789abcdefghijklmnopqrstuvwxyz";
const COLORS = ["red", "orange", "yellow", "green", "blue", "indigo", "violet", "black", "white", "grey", "pink", "teal"];
const ABBREVIATIONS = ["SQL", "TCP", "HTTP", "JSON", "XML", "SSL", "API", "CSS", "RAM", "SMS", "PCI", "USB"];
const LOCALES = ["en", "de", "fr", "es", "it", "pt", "nl", "sv", "pl", "ja", "ko", "zh"];
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
];
const NAME_PREFIXES = ["Mr", "Mrs", "Ms", "Miss", "Dr"];
const NAME_SUFFIXES = ["Jr.", "Sr.", "I", "II", "III", "IV", "MD", "DDS", "PhD"];
const JOB_AREAS = ["Accounts", "Brand", "Communications", "Creative", "Data", "Factors", "Integration", "Marketing", "Operations", "Optimization", "Research", "Security", "Tactics"];
const JOB_DESCRIPTORS = ["Central", "Chief", "Corporate", "Customer", "Direct", "Dynamic", "Forward", "Future", "Global", "Internal", "Lead", "National", "Principal", "Regional"];
const JOB_TYPES = ["Administrator", "Agent", "Analyst", "Architect", "Assistant", "Coordinator", "Designer", "Developer", "Director", "Engineer", "Executive", "Facilitator", "Liaison", "Manager", "Officer", "Planner", "Specialist", "Strategist", "Supervisor", "Technician"];
const CITIES = ["London", "Paris", "Berlin", "Madrid", "Rome", "Lisbon", "Dublin", "Vienna", "Oslo", "Helsinki", "Tokyo", "Sydney", "Toronto", "Chicago", "Austin", "Denver"];
const STREET_NAMES = ["Maple", "Oak", "Cedar", "Elm", "Pine", "Willow", "Birch", "Lake", "Hill", "River", "Park", "Church"];
const STREET_TYPES = ["Street", "Avenue", "Road", "Lane", "Drive", "Court", "Way", "Place"];
const COUNTRIES: readonly (readonly [string, string])[] = [["United Kingdom", "GB"], ["France", "FR"], ["Germany", "DE"], ["Spain", "ES"], ["Italy", "IT"], ["Portugal", "PT"], ["Ireland", "IE"], ["Austria", "AT"], ["Norway", "NO"], ["Finland", "FI"], ["Japan", "JP"], ["Australia", "AU"], ["Canada", "CA"], ["United States", "US"], ["India", "IN"], ["Brazil", "BR"]];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOMAIN_WORDS = ["alpha", "brisk", "cedar", "delta", "ember", "fable", "glint", "harbor", "indigo", "juniper", "kestrel", "lumen"];
const DOMAIN_SUFFIXES = ["com", "net", "org", "info", "biz", "io"];
const EXAMPLE_DOMAINS = ["example.com", "example.net", "example.org"];

function hex(value: number, width: number): string {
  let text = Number(value).toString(16);
  while (text.length < width) text = `0${text}`;
  return text.slice(-width);
}

function mix(vu: number, iteration: number, k: number): number {
  let h = Math.imul(vu ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(iteration + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(k + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * The value of dynamic variable `kind` (for example `$guid`) for its `k`-th occurrence in the plan,
 * counted as the script renderer counts them (`DynamicNumbering` in `resolveRequest.ts`).
 */
export function dynamicValue(kind: string, k: number, context: DynamicContext): string {
  const { vu, iteration, runTag, nowMs } = context;
  const m = mix(vu, iteration, k);
  const first = FIRST_NAMES[m % FIRST_NAMES.length];
  const last = LAST_NAMES[Math.floor(m / FIRST_NAMES.length) % LAST_NAMES.length];
  const person = `${first}.${last}`.toLowerCase();
  const draw = (salt: number): number => mix(m, salt, 101);
  const pick = <T>(list: readonly T[], salt: number): T => list[draw(salt) % list.length];
  const groups = (count: number, width: number, separator: string): string => {
    const parts: string[] = [];
    for (let i = 0; i < count; i++) parts.push(hex(draw(20 + i), width));
    return parts.join(separator);
  };
  const phone = `${200 + (m % 800)}-${200 + (Math.floor(m / 800) % 800)}-${String(10000 + (Math.floor(m / 640000) % 10000)).slice(1)}`;
  const streetName = `${pick(STREET_NAMES, 1)} ${pick(STREET_TYPES, 2)}`;
  const domainName = `${pick(DOMAIN_WORDS, 3)}.${pick(DOMAIN_SUFFIXES, 4)}`;
  const day = 86400000;
  const tagPart = runTag === "" ? "" : `r${runTag}-`;
  if (kind === "$guid" || kind === "$randomUUID") {
    const tag = runTag === "" ? "000000" : runTag;
    return `${hex(vu, 8)}-${hex(k, 4)}-4${tag.slice(0, 3)}-8${tag.slice(3)}-${hex(iteration, 12)}`;
  }
  if (kind === "$timestamp") return String(Math.floor(nowMs() / 1000));
  if (kind === "$isoTimestamp") return new Date(nowMs()).toISOString();
  if (kind === "$randomInt") return String(m % 1001);
  if (kind === "$randomFirstName") return first;
  if (kind === "$randomLastName") return last;
  if (kind === "$randomFullName") return `${first} ${last}`;
  if (kind === "$randomUserName") return `${person}${runTag === "" ? "" : `_r${runTag}`}_vu${vu}_it${iteration}_${k}`;
  if (kind === "$randomEmail") return `${person}+${tagPart}vu${vu}-it${iteration}-${k}@example.com`;
  if (kind === "$randomPhoneNumber") return phone;
  if (kind === "$randomAlphaNumeric") return ALPHANUMERIC[m % ALPHANUMERIC.length];
  if (kind === "$randomBoolean") return m % 2 === 0 ? "true" : "false";
  if (kind === "$randomColor") return pick(COLORS, 1);
  if (kind === "$randomHexColor") return `#${hex(draw(1), 6)}`;
  if (kind === "$randomAbbreviation") return pick(ABBREVIATIONS, 1);
  if (kind === "$randomIP") return `${1 + (draw(1) % 254)}.${draw(2) % 256}.${draw(3) % 256}.${1 + (draw(4) % 254)}`;
  if (kind === "$randomIPV6") return groups(8, 4, ":");
  if (kind === "$randomMACAddress") return groups(6, 2, ":");
  if (kind === "$randomPassword") {
    let password = "";
    for (let i = 0; i < 15; i++) password += ALPHANUMERIC[draw(40 + i) % ALPHANUMERIC.length];
    return password;
  }
  if (kind === "$randomLocale") return pick(LOCALES, 1);
  if (kind === "$randomUserAgent") return pick(USER_AGENTS, 1);
  if (kind === "$randomProtocol") return pick(["http", "https"], 1);
  if (kind === "$randomSemver") return `${draw(1) % 10}.${draw(2) % 10}.${draw(3) % 10}`;
  if (kind === "$randomNamePrefix") return pick(NAME_PREFIXES, 1);
  if (kind === "$randomNameSuffix") return pick(NAME_SUFFIXES, 1);
  if (kind === "$randomJobArea") return pick(JOB_AREAS, 1);
  if (kind === "$randomJobDescriptor") return pick(JOB_DESCRIPTORS, 1);
  if (kind === "$randomJobType") return pick(JOB_TYPES, 1);
  if (kind === "$randomJobTitle") return `${pick(JOB_DESCRIPTORS, 1)} ${pick(JOB_AREAS, 2)} ${pick(JOB_TYPES, 3)}`;
  if (kind === "$randomPhoneNumberExt") return `${phone}x${100 + (draw(5) % 9900)}`;
  if (kind === "$randomCity") return pick(CITIES, 1);
  if (kind === "$randomStreetName") return streetName;
  if (kind === "$randomStreetAddress") return `${1 + (draw(6) % 9999)} ${streetName}`;
  if (kind === "$randomCountry") return pick(COUNTRIES, 1)[0];
  if (kind === "$randomCountryCode") return pick(COUNTRIES, 1)[1];
  if (kind === "$randomLatitude") return (((draw(1) % 1800001) / 10000) - 90).toFixed(4);
  if (kind === "$randomLongitude") return (((draw(2) % 3600001) / 10000) - 180).toFixed(4);
  if (kind === "$randomDateFuture") return new Date(nowMs() + (1 + (draw(1) % 365)) * day).toISOString();
  if (kind === "$randomDatePast") return new Date(nowMs() - (1 + (draw(1) % 365)) * day).toISOString();
  if (kind === "$randomDateRecent") return new Date(nowMs() - (draw(1) % day)).toISOString();
  if (kind === "$randomWeekday") return pick(WEEKDAYS, 1);
  if (kind === "$randomMonth") return pick(MONTHS, 1);
  if (kind === "$randomDomainName") return domainName;
  if (kind === "$randomDomainSuffix") return pick(DOMAIN_SUFFIXES, 4);
  if (kind === "$randomDomainWord") return pick(DOMAIN_WORDS, 3);
  if (kind === "$randomExampleEmail") return `${person}+${tagPart}vu${vu}-it${iteration}-${k}@${pick(EXAMPLE_DOMAINS, 7)}`;
  if (kind === "$randomUrl") return `${pick(["http", "https"], 8)}://${domainName}`;
  return "";
}
