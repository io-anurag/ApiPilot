import type { ApiInputDescriptor } from "@apipilot/shared-domain";

/**
 * The detected input format of the file that started a workflow (specs/056 FR-041). The label is
 * always text; the icon is decoration (CLAUDE.md section 38: no state conveyed by color alone).
 */
export function InputFormatBadge({ input }: Readonly<{ input: ApiInputDescriptor }>) {
  return (
    <span
      data-testid="input-format-badge"
      data-format={input.format}
      title={`Detected from the content of ${input.filename}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-subtle px-2.5 py-0.5 font-mono text-xs font-medium text-text-secondary"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-3.5 w-3.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 4h7l4 4v12H7V4z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M14 4v4h4" />
      </svg>
      <span>Input: {input.label}</span>
    </span>
  );
}
