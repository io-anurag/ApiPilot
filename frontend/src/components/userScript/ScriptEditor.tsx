import { useDeferredValue, useMemo, useRef } from "react";
import type { ScriptProblem } from "@apipilot/shared-domain";
import { highlightJavaScript, type TokenKind } from "./highlightJavaScript";
import { ScriptProblems } from "./ScriptProblems";

/** Above this size highlighting is turned off, so typing stays responsive near the 1 MiB limit (research R19). */
export const HIGHLIGHT_LIMIT_BYTES = 256 * 1024;

export const CREDENTIALS_NOTE = "Credentials belong in environment values, not in the script: read them through __ENV and map each name in Run setup. ApiPilot cannot check that a script holds none.";
export const LINE_ENDING_NOTE = "Saving from this editor stores the text with LF line endings, as a new version that needs a new confirmation.";

const TOKEN_CLASSES: Record<TokenKind, string> = {
  comment: "italic text-slate-500 dark:text-slate-400",
  string: "text-success-700 dark:text-success-300",
  template: "text-success-700 dark:text-success-300",
  number: "text-warning-700 dark:text-warning-300",
  keyword: "font-semibold text-brand-700 dark:text-brand-300",
  identifier: "text-slate-900 dark:text-slate-100",
  punctuation: "text-slate-500 dark:text-slate-400",
  whitespace: "",
};

/** The overlay and the textarea must lay text out identically, so they share these classes. */
const TEXT_LAYOUT = "m-0 whitespace-pre p-3 font-mono text-xs leading-5";

/**
 * The script editor (AP-034 FR-010 to FR-012, research R19): a native textarea, the only focusable
 * and the only labelled layer, over an `aria-hidden` highlighted copy, beside an `aria-hidden` line
 * gutter that marks each line with a problem in text ("!"). The accessible list of problems sits
 * below. Nothing here evaluates the script.
 */
export function ScriptEditor({
  value,
  onChange,
  problems,
  label,
}: Readonly<{ value: string; onChange: (value: string) => void; problems: readonly ScriptProblem[]; label: string }>) {
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
    <div className="space-y-2" data-testid="script-editor">
      <p className="text-xs text-muted">{CREDENTIALS_NOTE}</p>
      <p className="text-xs text-muted">{LINE_ENDING_NOTE}</p>
      {!highlighting && <p className="text-xs text-muted" data-testid="highlighting-off">Highlighting is off for scripts over 256 KiB, so typing stays responsive.</p>}
      <div className="flex h-128 overflow-hidden rounded-md border border-border bg-surface focus-within:ring-2 focus-within:ring-brand-500">
        <div ref={gutter} aria-hidden="true" data-testid="script-editor-gutter" className={`${TEXT_LAYOUT} shrink-0 select-none overflow-hidden border-r border-border bg-chrome px-2 text-right text-muted`}>
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
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            wrap="off"
            onChange={(event) => onChange(event.target.value)}
            onScroll={syncScroll}
            className={`${TEXT_LAYOUT} absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent focus:outline-none ${highlighting ? "text-transparent caret-slate-900 dark:caret-slate-100" : "text-slate-900 dark:text-slate-100"}`}
          />
        </div>
      </div>
      {problems.length > 0 && <ScriptProblems problems={problems} title="This version was not saved" />}
    </div>
  );
}
