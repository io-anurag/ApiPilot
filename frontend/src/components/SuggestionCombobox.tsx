import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

export interface ComboboxOption {
  name: string;
  /** Shown beside the name. */
  detail?: string;
}

const MIN_LIST_HEIGHT = 200;
const MAX_LIST_HEIGHT = 320;
/** `w-md`, in pixels. */
const LIST_WIDTH = 448;

/**
 * A free-text field with a dropdown of suggested values (ARIA combobox, editable, list
 * autocomplete). Typing filters the list (names starting with the text first, then names containing
 * it); the chevron, or ArrowDown, opens the whole list. Arrow keys move, Enter or Tab picks the
 * highlighted option, Escape closes, and a click picks too. Any text can be typed: the list only
 * suggests, so an unlisted value is kept as typed. The list is positioned against the viewport so a
 * scrolling or clipping container does not cut it off.
 */
export function SuggestionCombobox({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  monospace = false,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly ComboboxOption[];
  placeholder?: string;
  disabled?: boolean;
  monospace?: boolean;
}>) {
  const id = useId();
  const listId = `${id}-options`;
  const fieldRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  // The chevron (or ArrowDown on a closed list) shows every option instead of filtering by the text.
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
  } | null>(null);

  const text = value.trim().toLowerCase();
  const matches =
    showAll || text === ""
      ? options
      : [
          ...options.filter((option) => option.name.toLowerCase().startsWith(text)),
          ...options.filter(
            (option) =>
              !option.name.toLowerCase().startsWith(text) && option.name.toLowerCase().includes(text),
          ),
        ];
  const listOpen = open && matches.length > 0;

  useLayoutEffect(() => {
    if (!listOpen) return;
    const place = () => {
      const box = fieldRef.current?.getBoundingClientRect();
      if (!box) return;
      // Keep the 28rem list inside the viewport when the field sits near the right edge.
      const left = Math.max(8, Math.min(box.left, window.innerWidth - LIST_WIDTH - 8));
      const below = window.innerHeight - box.bottom - 12;
      const above = box.top - 12;
      // Open upwards when the space below is too small for a useful list and there is more above.
      if (below < MIN_LIST_HEIGHT && above > below) {
        setAnchor({
          left,
          bottom: window.innerHeight - box.top + 4,
          maxHeight: Math.min(MAX_LIST_HEIGHT, above),
        });
      } else {
        setAnchor({ left, top: box.bottom + 4, maxHeight: Math.min(MAX_LIST_HEIGHT, below) });
      }
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [listOpen]);

  useLayoutEffect(() => {
    if (listOpen) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [listOpen, active, listId]);

  function close() {
    setOpen(false);
    setShowAll(false);
  }

  function pick(name: string) {
    onChange(name);
    close();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!listOpen) {
      if (event.key === "ArrowDown" && !disabled) {
        event.preventDefault();
        setShowAll(true);
        setActive(0);
        setOpen(true);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (current + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(matches[active].name);
    } else if (event.key === "Tab") {
      // Tab completes a suggestion that differs from the text, but moves on as usual once the
      // field already holds it, so the keyboard is never trapped here.
      if (matches[active].name === value) {
        close();
        return;
      }
      event.preventDefault();
      pick(matches[active].name);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  return (
    <div className="relative min-w-0">
      <input
        id={id}
        ref={fieldRef}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={listOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={listOpen ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        // A name still too long for a narrow field is readable in full on hover.
        title={value || undefined}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
          setShowAll(false);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        onBlur={close}
        className={`w-full rounded-md border border-border bg-surface py-1 pl-2 pr-8 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50 ${monospace ? "font-mono" : ""}`}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Show all options for ${label}`}
        aria-expanded={listOpen}
        aria-controls={listId}
        disabled={disabled}
        // mousedown, not click: the field must keep focus, or its blur would close the list first.
        onMouseDown={(event) => {
          event.preventDefault();
          fieldRef.current?.focus();
          if (listOpen) {
            close();
          } else {
            setShowAll(true);
            setActive(0);
            setOpen(true);
          }
        }}
        className="absolute inset-y-0 right-0 flex w-7 items-center justify-center text-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      <ul
        id={listId}
        role="listbox"
        aria-label={`Options for ${label}`}
        hidden={!listOpen}
        style={anchor ? { top: anchor.top, bottom: anchor.bottom, left: anchor.left, maxHeight: anchor.maxHeight } : undefined}
        // A readable width of its own, not the narrow field's: a name must never wrap.
        className="fixed z-50 w-md max-w-full overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg"
      >
        {matches.map((option, index) => (
          <li
            key={option.name}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            onMouseDown={(event) => {
              event.preventDefault();
              pick(option.name);
            }}
            className={`grid cursor-pointer grid-cols-[minmax(11rem,auto)_minmax(0,1fr)] items-baseline gap-x-3 px-3 py-1.5 text-sm ${index === active ? "bg-brand-50 dark:bg-brand-500/20" : ""}`}
          >
            <span className="whitespace-nowrap font-mono text-xs text-text-primary">{option.name}</span>
            {option.detail && <span className="text-xs text-muted">{option.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
