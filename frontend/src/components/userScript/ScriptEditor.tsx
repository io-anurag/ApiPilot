import { useDeferredValue, useMemo, useRef, type ReactNode } from "react";
import type { ScriptProblem } from "@apipilot/shared-domain";
import { Pill } from "../patterns/Pill";
import { highlightJavaScript, type TokenKind } from "./highlightJavaScript";
import { DocumentGlyph } from "./ScriptPanel";
import { ScriptProblems } from "./ScriptProblems";

/** Above this size highlighting is turned off, so typing stays responsive near the 1 MiB limit (research R19). */
export const HIGHLIGHT_LIMIT_BYTES = 256 * 1024;

export const CREDENTIALS_NOTE = "Credentials belong in environment values, not in the script: read them through __ENV and map each name in Run setup. ApiPilot cannot check that a script holds none.";
export const LINE_ENDING_NOTE = "Saving from this editor stores the text with LF line endings, as a new version that needs a new confirmation.";

const TOKEN_CLASSES: Record<TokenKind, string> = {
  comment: "italic text-muted",
  string: "text-success",
  template: "text-success",
  number: "text-warning",
  keyword: "font-semibold text-brand-700",
  identifier: "text-text-primary",
  punctuation: "text-muted",
  whitespace: "",
};

/** The overlay and the textarea must lay text out identically, so they share these classes. */
const TEXT_LAYOUT = "m-0 whitespace-pre p-3 font-mono text-xs leading-5";

/**
 * The script document (AP-034 FR-010 to FR-012, research R19; layout: specs/051-user-script-page-redesign
 * FR-003). One component for the stored script and for editing it: a bar with the name, the line count
 * and "Read only" or "Editing", the `toolbar` at its right, a native textarea, the only focusable and the
 * only labelled layer, over an `aria-hidden` highlighted copy, beside an `aria-hidden` line gutter that
 * marks each line with a problem in text ("!"), then the notes, the accessible list of problems and the
 * `footer`. Read only is the same view with the textarea locked, so Edit does not move the layout.
 * Nothing here evaluates the script.
 */
export function ScriptEditor({
  value,
  onChange,
  problems,
  label,
  readOnly = false,
  fileName,
  toolbar,
  footer,
}: Readonly<{
  value: string;
  onChange?: (value: string) => void;
  problems: readonly ScriptProblem[];
  label: string;
  readOnly?: boolean;
  /** Shown in the bar, as text or, for a new script, as the name field; defaults to the label. */
  fileName?: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
}>) {
  const overlay = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const deferred = useDeferredValue(value);
  const highlighting = new TextEncoder().encode(deferred).length <= HIGHLIGHT_LIMIT_BYTES;
  const tokens = useMemo(() => (highlighting ? highlightJavaScript(deferred) : []), [deferred, highlighting]);
  const lineCount = value.split("\n").length;
  const problemLines = new Set(problems.map((problem) => problem.line));

  function syncScroll(event: React.UIEvent<HTMLTextAreaElement>) {
    const { scrollTop, scrollLeft } = event.currentTarget;
    if (overlay.current) {
      overlay.current.scrollTop = scrollTop;
      overlay.current.scrollLeft = scrollLeft;
    }
    if (gutter.current) gutter.current.scrollTop = scrollTop;
  }

  return (
    <div className="relative min-w-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm" data-testid="script-editor">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border bg-surface-subtle px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex min-w-0 items-center gap-2 text-text-primary">
            <DocumentGlyph className="h-4 w-4 shrink-0 text-brand-700" />
            {typeof fileName === "string" || fileName === undefined ? <span className="truncate font-mono text-xs font-semibold">{fileName ?? label}</span> : fileName}
          </span>
          <span className="text-xs text-muted">{lineCount === 1 ? "1 line" : `${lineCount} lines`}</span>
          <Pill tone={readOnly ? "line" : "mint"}>{readOnly ? "Read only" : "Editing"}</Pill>
        </div>
        {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
      </div>

      <div className="flex h-128 overflow-hidden focus-within:ring-2 focus-within:ring-inset focus-within:ring-brand-500">
        <div ref={gutter} aria-hidden="true" data-testid="script-editor-gutter" className={`${TEXT_LAYOUT} shrink-0 select-none overflow-hidden border-r border-border bg-surface-subtle px-2 text-right text-muted`}>
          {Array.from({ length: lineCount }, (_unused, index) => (
            <div key={index} className={problemLines.has(index + 1) ? "font-semibold text-danger-700 dark:text-danger-200" : undefined}>
              {problemLines.has(index + 1) ? "! " : ""}
              {index + 1}
            </div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {highlighting && (
            <pre ref={overlay} aria-hidden="true" data-testid="script-editor-overlay" className={`${TEXT_LAYOUT} pointer-events-none absolute inset-0 overflow-hidden`}>
              {tokens.map((token, index) => (
                <span key={index} className={TOKEN_CLASSES[token.kind]}>
                  {token.text}
                </span>
              ))}
              {"\n"}
            </pre>
          )}
          <textarea
            aria-label={label}
            value={value}
            readOnly={readOnly}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            wrap="off"
            onChange={(event) => onChange?.(event.target.value)}
            onScroll={syncScroll}
            className={`${TEXT_LAYOUT} absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent focus:outline-none ${highlighting ? "text-transparent caret-text-primary" : "text-text-primary"}`}
          />
        </div>
      </div>

      <div className="space-y-1 border-t border-border bg-surface-subtle px-4 py-3 text-xs text-muted sm:px-5">
        <p>{CREDENTIALS_NOTE}</p>
        {!readOnly && <p>{LINE_ENDING_NOTE}</p>}
        {readOnly && <p>The stored script is shown read only. The editor never runs it.</p>}
        {!highlighting && <p data-testid="highlighting-off">Highlighting is off for scripts over 256 KiB, so typing stays responsive.</p>}
      </div>

      {problems.length > 0 && (
        <div className="border-t border-border p-4 sm:p-5">
          <ScriptProblems problems={problems} title="This version was not saved" />
        </div>
      )}
      {footer && <div className="flex flex-wrap items-center gap-2 border-t border-border bg-chrome px-4 py-3 sm:px-5">{footer}</div>}
    </div>
  );
}
