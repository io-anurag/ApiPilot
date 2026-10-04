import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

export interface ReferenceSuggestion {
  /** What is inserted between `{{` and `}}`. */
  name: string;
  /** Where the value comes from, shown beside the name. */
  detail: string;
}

const OPEN = /\{\{(\$?[A-Za-z0-9_]*)$/;
const INPUT_CLASS =
  "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 dark:text-slate-100";

/**
 * A text field that offers `{{name}}` references as the engineer types `{{`
 * (specs/037-request-chain-performance FR-005, research R23): names extracted by earlier steps,
 * environment value names, data set columns and dynamic variables, passed in by the caller. It follows
 * the ARIA combobox pattern: arrow keys move through the list, Enter or Tab inserts, Escape closes,
 * and the field keeps focus throughout. Nothing is inserted without a keystroke or click.
 *
 * The list is positioned against the viewport, not the field's container: fields sit inside tables
 * that scroll sideways, and such a container would otherwise clip the list.
 */
export function ReferenceField({
  label,
  value,
  onChange,
  onCommit,
  suggestions,
  multiline = false,
  monospace = false,
  disabled = false,
  invalid,
  placeholder,
  rows = 6,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Called when the field loses focus, so the caller can save. */
  onCommit?: () => void;
  suggestions: readonly ReferenceSuggestion[];
  multiline?: boolean;
  monospace?: boolean;
  disabled?: boolean;
  /** An error to show under the field, announced with it. */
  invalid?: string | null;
  placeholder?: string;
  rows?: number;
}>) {
  const id = useId();
  const listId = `${id}-suggestions`;
  const errorId = `${id}-error`;
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const matches = query === null ? [] : suggestions.filter((suggestion) => suggestion.name.toLowerCase().startsWith(query.toLowerCase()));
  const open = matches.length > 0;
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);

  // While the list is open it follows the field through page scrolls and resizes.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = fieldRef.current?.getBoundingClientRect();
      if (box) setAnchor({ top: box.bottom + 4, left: box.left, width: box.width });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // Arrow-key navigation keeps the highlighted suggestion visible inside the scrollable list.
  useLayoutEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, listId]);

  function track(text: string, caret: number | null) {
    const before = text.slice(0, caret ?? text.length);
    const match = OPEN.exec(before);
    setQuery(match ? match[1] : null);
    setActive(0);
  }

  function insert(name: string) {
    const field = fieldRef.current;
    const caret = field?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(OPEN, "");
    const after = value.slice(caret).replace(/^\}\}/, "");
    const next = `${before}{{${name}}}${after}`;
    onChange(next);
    setQuery(null);
    const position = before.length + name.length + 4;
    requestAnimationFrame(() => field?.setSelectionRange(position, position));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (current + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      insert(matches[active].name);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setQuery(null);
    }
  }

  const common = {
    id,
    ref: fieldRef,
    value,
    disabled,
    placeholder,
    role: "combobox" as const,
    "aria-expanded": open,
    "aria-controls": listId,
    "aria-autocomplete": "list" as const,
    "aria-activedescendant": open ? `${listId}-${active}` : undefined,
    "aria-invalid": invalid ? true : undefined,
    "aria-describedby": invalid ? errorId : undefined,
    className: `${INPUT_CLASS} ${monospace ? "font-mono text-xs" : ""} ${invalid ? "border-danger-500" : ""}`,
    onKeyDown: handleKeyDown,
    onChange: (event: { target: { value: string; selectionStart: number | null } }) => {
      onChange(event.target.value);
      track(event.target.value, event.target.selectionStart);
    },
    onBlur: () => {
      setQuery(null);
      onCommit?.();
    },
  };

  return (
    <div className="relative min-w-0 flex-1">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {multiline ? <textarea {...common} rows={rows} spellCheck={false} /> : <input {...common} type="text" spellCheck={false} autoComplete="off" />}
      <ul
        id={listId}
        role="listbox"
        aria-label={`References for ${label}`}
        hidden={!open}
        style={anchor ? { top: anchor.top, left: anchor.left, width: anchor.width } : undefined}
        className="fixed z-50 max-h-96 min-w-80 overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg"
      >
        {matches.map((suggestion, index) => (
          <li
            key={suggestion.name}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            onMouseDown={(event) => {
              event.preventDefault();
              insert(suggestion.name);
            }}
            className={`flex cursor-pointer items-baseline justify-between gap-3 px-2 py-1 text-sm ${index === active ? "bg-brand-50 dark:bg-brand-500/20" : ""}`}
          >
            <span className="font-mono text-xs text-slate-900 dark:text-slate-100">{`{{${suggestion.name}}}`}</span>
            <span className="text-xs text-muted">{suggestion.detail}</span>
          </li>
        ))}
      </ul>
      {invalid && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger-700 dark:text-danger-200">
          {invalid}
        </p>
      )}
    </div>
  );
}
