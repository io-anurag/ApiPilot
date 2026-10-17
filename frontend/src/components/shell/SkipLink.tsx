/**
 * First in the tab order (AP-054 FR-002): jumps over the sidebar to the page. It focuses `<main>`
 * itself instead of following `href="#main"`, because the hash carries the destination address
 * and a second meaning for it would navigate away.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      onClick={(event) => {
        event.preventDefault();
        document.getElementById("main")?.focus();
      }}
      className="sr-only rounded-md bg-accent px-3 py-2 text-sm font-semibold text-on-accent ring-2 ring-brand-500 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:outline-none"
    >
      Skip to main content
    </a>
  );
}
