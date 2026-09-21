const VARIABLE_TOKEN_PATTERN = /\{\{\s*[^{}\s]+\s*\}\}/g;

/**
 * Renders `text` with every `{{variable}}` placeholder visually distinct from literal text
 * (FR-002) — used for both the raw (unresolved) and resolved request views, so a viewer can
 * always tell a still-templated value apart from a literal one, even after substitution.
 */
export function VariableHighlightedText({ text }: Readonly<{ text: string }>) {
  const parts = text.split(VARIABLE_TOKEN_PATTERN);
  const tokens = text.match(VARIABLE_TOKEN_PATTERN) ?? [];
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {tokens[index] && (
            <span className="rounded bg-brand-100 px-1 py-0.5 font-mono text-brand-800 dark:bg-brand-500/20 dark:text-brand-200">
              {tokens[index]}
            </span>
          )}
        </span>
      ))}
    </>
  );
}
