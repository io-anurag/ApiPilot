import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { WorkflowIcon } from "./WorkflowIcon";
import { filterCommands, type Command } from "./paletteCommands";
import { isResultsView, workflowById } from "./workflowCatalog";

function CommandIcon({ command }: Readonly<{ command: Command }>) {
  if (command.kind === "workflow") {
    if (isResultsView(command.id)) {
      return (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-section-results/30 bg-section-results/10 text-section-results">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
            <path d="M5 20V10m7 10V4m7 16v-7" />
          </svg>
        </span>
      );
    }
    const workflow = workflowById(command.id);
    return (
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${workflow.tone.tile}`}>
        <WorkflowIcon name={workflow.icon} className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
        {command.kind === "back-to-start" ? (
          <path d="M19 12H5m6 6-6-6 6-6" />
        ) : command.target === "dark" ? (
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        )}
      </svg>
    </span>
  );
}

const KIND_LABEL: Record<Command["kind"], string> = {
  workflow: "Workflow",
  "back-to-start": "Navigation",
  theme: "Theme",
};

/**
 * Command palette (AP-038 US3, contracts/ui-contract.md): a filter field over a fixed command
 * list, built on the shared `Dialog` for modal semantics, focus trap, Escape and focus restore.
 * Focus stays in the filter field; the active option is conveyed with `aria-activedescendant`
 * (the ARIA combobox pattern), so arrow keys never move focus out of the field.
 */
export function CommandPalette({
  commands,
  onRun,
  onClose,
  shortcutHint,
}: Readonly<{
  commands: readonly Command[];
  onRun: (command: Command) => void;
  onClose: () => void;
  shortcutHint: string;
}>) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const filtered = useMemo(() => filterCommands(commands, query), [commands, query]);
  const active = filtered.length > 0 ? Math.min(activeIndex, filtered.length - 1) : -1;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (filtered.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((active + step + filtered.length) % filtered.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active >= 0) onRun(filtered[active]);
    }
  }

  return (
    <Dialog
      labelledBy={titleId}
      testId="command-palette"
      onClose={onClose}
      onBackdropClick={onClose}
      panelClassName="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
    >
      <h2 id={titleId} className="sr-only">
        Command palette
      </h2>
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4 shrink-0 text-muted" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Filter commands"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          placeholder="Open a workflow or switch theme…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent text-sm text-text-primary placeholder:text-muted focus:outline-none"
        />
        <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted sm:inline">
          Esc
        </kbd>
      </div>

      {filtered.length === 0 ? (
        <p role="status" className="px-4 py-6 text-center text-sm text-muted">
          No matching commands
        </p>
      ) : (
        <ul id={listId} role="listbox" aria-label="Commands" className="max-h-80 overflow-y-auto p-2">
          {filtered.map((command, index) => (
            <li
              key={command.label}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => onRun(command)}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm ${
                index === active
                  ? "bg-surface-strong text-text-primary"
                  : "text-text-secondary"
              }`}
            >
              <CommandIcon command={command} />
              <span className="font-medium">{command.label}</span>
              <span className="ml-auto text-xs text-muted">{KIND_LABEL[command.kind]}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-xs text-muted">
        <span>↑ ↓ to move</span>
        <span>Enter to choose</span>
        <span>Esc to close</span>
        <span className="ml-auto font-mono">{shortcutHint}</span>
      </p>
    </Dialog>
  );
}
