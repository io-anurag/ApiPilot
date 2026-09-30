import { useId, useState } from "react";
import { BUTTON_STYLES } from "./controlStyles";

interface DynamicVariable {
  name: string;
  description: string;
}

interface DynamicVariableCategory {
  name: string;
  variables: readonly DynamicVariable[];
}

const DYNAMIC_VARIABLE_CATEGORIES: readonly DynamicVariableCategory[] = [
  {
    name: "Common",
    variables: [
      { name: "$guid", description: "UUID v4-style GUID" },
      { name: "$timestamp", description: "UNIX timestamp" },
      { name: "$isoTimestamp", description: "ISO timestamp" },
      { name: "$randomUUID", description: "Random UUID" },
    ],
  },
  {
    name: "Text, numbers, and colors",
    variables: [
      { name: "$randomAlphaNumeric", description: "Alpha-numeric character" },
      { name: "$randomBoolean", description: "Boolean" },
      { name: "$randomInt", description: "Integer" },
      { name: "$randomColor", description: "Color" },
      { name: "$randomHexColor", description: "Hex color" },
      { name: "$randomAbbreviation", description: "Abbreviation" },
    ],
  },
  {
    name: "Internet and IP addresses",
    variables: [
      { name: "$randomIP", description: "IPv4 address" },
      { name: "$randomIPV6", description: "IPv6 address" },
      { name: "$randomMACAddress", description: "MAC address" },
      { name: "$randomPassword", description: "Password" },
      { name: "$randomLocale", description: "Locale" },
      { name: "$randomUserAgent", description: "User agent" },
      { name: "$randomProtocol", description: "Protocol" },
      { name: "$randomSemver", description: "Semantic version" },
    ],
  },
  {
    name: "Names",
    variables: [
      { name: "$randomFirstName", description: "First name" },
      { name: "$randomLastName", description: "Last name" },
      { name: "$randomFullName", description: "Full name" },
      { name: "$randomNamePrefix", description: "Name prefix" },
      { name: "$randomNameSuffix", description: "Name suffix" },
    ],
  },
  {
    name: "Profession",
    variables: [
      { name: "$randomJobArea", description: "Job area" },
      { name: "$randomJobDescriptor", description: "Job descriptor" },
      { name: "$randomJobTitle", description: "Job title" },
      { name: "$randomJobType", description: "Job type" },
    ],
  },
  {
    name: "Phone, address, and location",
    variables: [
      { name: "$randomPhoneNumber", description: "Phone number" },
      { name: "$randomPhoneNumberExt", description: "Phone number with extension" },
      { name: "$randomCity", description: "City" },
      { name: "$randomStreetName", description: "Street name" },
      { name: "$randomStreetAddress", description: "Street address" },
      { name: "$randomCountry", description: "Country" },
      { name: "$randomCountryCode", description: "Country code" },
      { name: "$randomLatitude", description: "Latitude" },
      { name: "$randomLongitude", description: "Longitude" },
    ],
  },
  {
    name: "Dates",
    variables: [
      { name: "$randomDateFuture", description: "Future date" },
      { name: "$randomDatePast", description: "Past date" },
      { name: "$randomDateRecent", description: "Recent date" },
      { name: "$randomWeekday", description: "Weekday" },
      { name: "$randomMonth", description: "Month" },
    ],
  },
  {
    name: "Domains, emails, and usernames",
    variables: [
      { name: "$randomDomainName", description: "Domain name" },
      { name: "$randomDomainSuffix", description: "Domain suffix" },
      { name: "$randomDomainWord", description: "Domain word" },
      { name: "$randomEmail", description: "Email address" },
      { name: "$randomExampleEmail", description: "Example-domain email" },
      { name: "$randomUserName", description: "Username" },
      { name: "$randomUrl", description: "URL" },
    ],
  },
];

export function PostmanDynamicVariablePicker({
  fieldLabel,
  disabled,
  onInsert,
}: Readonly<{
  fieldLabel: string;
  disabled: boolean;
  onInsert: (name: string) => void;
}>) {
  const id = useId();
  const [variable, setVariable] = useState(
    DYNAMIC_VARIABLE_CATEGORIES[0].variables[0].name,
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="sr-only">
        Random value for {fieldLabel}
      </label>
      <select
        id={id}
        aria-label={`Random value for ${fieldLabel}`}
        value={variable}
        disabled={disabled}
        onChange={(event) => setVariable(event.target.value)}
        className="min-w-56 rounded-md border border-border bg-surface px-2 py-1 text-xs font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {DYNAMIC_VARIABLE_CATEGORIES.map((category) => (
          <optgroup key={category.name} label={category.name}>
            {category.variables.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name} - {entry.description}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onInsert(variable)}
        aria-label={`Insert ${variable} into ${fieldLabel}`}
        className={BUTTON_STYLES.secondary}
      >
        Insert
      </button>
      <span className="text-xs text-muted">Generated when this request runs.</span>
    </div>
  );
}
