import { K6_MARK, OPENAPI_MARK } from "../WorkflowIcon";

const FOCUS =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** The hero's two buttons: a dark green fill in light, the accent in dark, as in the mock-up. */
const GET_STARTED = `inline-flex items-center gap-2 rounded-lg bg-success-700 px-5 py-2.5 text-sm font-semibold text-white motion-safe:transition-colors hover:bg-success-800 dark:bg-accent dark:text-on-accent dark:hover:brightness-95 ${FOCUS}`;
const LEARN_MORE = `inline-flex items-center rounded-lg border border-border-control bg-surface px-5 py-2.5 text-sm font-semibold text-text-primary motion-safe:transition-colors hover:bg-surface-hover ${FOCUS}`;

/**
 * Decorative: an assistant between the three artifacts ApiPilot starts from and the tests it produces. It carries no
 * information the text beside it does not, so it is hidden from assistive technology. Colours are tokens, so it follows
 * the theme.
 */
function HeroIllustration() {
  return (
    <svg viewBox="0 0 360 230" fill="none" aria-hidden="true" focusable="false" className="mx-auto h-auto w-full max-w-sm">
      <defs>
        <radialGradient id="home-hero-glow" cx="50%" cy="55%" r="50%">
          <stop offset="0%" stopColor="var(--color-brand-400)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--color-brand-400)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="190" cy="130" rx="170" ry="100" fill="url(#home-hero-glow)" />

      {/* Connectors between the artifacts, the assistant and the generated output. */}
      <path d="M96 100c24 0 30 34 60 34M232 62c26 0 28-12 50-12M214 168c24 0 36-6 58-6" className="stroke-brand-500" strokeWidth="1.5" strokeDasharray="4 4" strokeLinecap="round" />

      {/* The artifacts it reads. */}
      <rect x="14" y="18" width="104" height="108" rx="10" className="fill-surface stroke-border-strong" strokeWidth="1.5" />
      <g fontFamily="IBM Plex Sans, Segoe UI, sans-serif" fontSize="11" fontWeight="600" className="fill-text-primary">
        <rect x="26" y="30" width="80" height="26" rx="6" className="fill-surface-subtle" />
        <rect x="32" y="36" width="14" height="14" rx="3.5" className="fill-success-600" />
        <path d={OPENAPI_MARK} className="fill-white" transform="translate(34 38) scale(0.4)" />
        <text x="52" y="47">OpenAPI</text>
        <rect x="26" y="62" width="80" height="26" rx="6" className="fill-surface-subtle" />
        <circle cx="39" cy="75" r="7" className="fill-warning-500" />
        <path d="m36 78 6-6m-2.5-.7 3.2.7-.7 3.2" className="stroke-white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <text x="52" y="79">Postman</text>
        <rect x="26" y="94" width="80" height="26" rx="6" className="fill-surface-subtle" />
        <rect x="32" y="100" width="14" height="14" rx="3.5" className="fill-method-patch" />
        <path d={K6_MARK} className="fill-white" transform="translate(34 102) scale(0.4)" />
        <text x="52" y="111">k6</text>
      </g>

      {/* The monitor with the generated tests. */}
      <rect x="150" y="16" width="112" height="72" rx="8" className="fill-code-surface stroke-code-border" strokeWidth="1.5" />
      <circle cx="162" cy="27" r="2.2" className="fill-danger-400" />
      <circle cx="171" cy="27" r="2.2" className="fill-warning-400" />
      <circle cx="180" cy="27" r="2.2" className="fill-success-400" />
      <path d="M162 42h46M162 53h72M162 64h34M162 75h58" className="stroke-success-400" strokeWidth="3" strokeLinecap="round" opacity="0.85" />
      <path d="M200 64h26" className="stroke-code-text" strokeWidth="3" strokeLinecap="round" opacity="0.7" />

      {/* A snapshot of the result. */}
      <rect x="290" y="30" width="48" height="48" rx="11" className="fill-accent stroke-brand-500" strokeWidth="1.5" />
      <path d="M303 47h5l3-4h6l3 4h5a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-22a2 2 0 0 1-2-2V49a2 2 0 0 1 2-2z" className="stroke-on-accent" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="314" cy="56" r="4.5" className="stroke-on-accent" strokeWidth="2" />

      {/* The assistant. */}
      <ellipse cx="206" cy="214" rx="46" ry="6" className="fill-text-primary" opacity="0.12" />
      <rect x="176" y="152" width="60" height="56" rx="22" className="fill-accent stroke-brand-500" strokeWidth="1.5" />
      <rect x="196" y="170" width="20" height="14" rx="4" className="fill-surface" opacity="0.7" />
      <path d="M176 172c-12 2-18 10-16 20M236 172c12 2 18 10 16 20" className="stroke-brand-500" strokeWidth="6" strokeLinecap="round" />
      <path d="M206 112v10" className="stroke-text-secondary" strokeWidth="3" strokeLinecap="round" />
      <circle cx="206" cy="110" r="5" className="fill-brand-500" />
      <rect x="168" y="120" width="76" height="52" rx="22" className="fill-white stroke-border-strong" strokeWidth="1.5" />
      <rect x="177" y="129" width="58" height="34" rx="15" className="fill-code-surface" />
      <ellipse cx="194" cy="146" rx="5.5" ry="6.5" className="fill-success-300" />
      <ellipse cx="218" cy="146" rx="5.5" ry="6.5" className="fill-success-300" />

      {/* The tests it writes. */}
      <rect x="278" y="132" width="52" height="52" rx="12" className="fill-accent stroke-brand-500" strokeWidth="1.5" />
      <text x="304" y="166" textAnchor="middle" fontFamily="JetBrains Mono, Consolas, monospace" fontSize="20" fontWeight="700" className="fill-on-accent">
        {"{ }"}
      </text>
    </svg>
  );
}

/**
 * The welcome hero (AP-059 FR-002): who ApiPilot is for and the one obvious first action. "Get started" opens the
 * recommended workflow and "Learn more" opens the same Help dialog as the header, so neither invents a destination.
 */
export function HomeHero({ onGetStarted, onLearnMore }: Readonly<{ onGetStarted: () => void; onLearnMore: () => void }>) {
  return (
    <section
      aria-labelledby="home-hero-heading"
      data-testid="home-hero"
      className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-lime-pale via-surface to-mint p-6 sm:p-8 lg:p-10"
    >
      <div className="grid items-center gap-6 lg:grid-cols-5 lg:gap-8">
        <div className="space-y-4 lg:col-span-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">Welcome to ApiPilot</p>
          <h2 id="home-hero-heading" className="font-display text-3xl font-bold leading-tight tracking-tight text-text-primary sm:text-4xl">
            From API specification to executable tests <span className="text-brand-700">with AI</span>
          </h2>
          <p className="max-w-xl text-sm leading-6 text-text-secondary">
            Analyze your APIs, generate test scenarios, build requests and assertions, identify dependencies, and create ready-to-run test artifacts.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button type="button" onClick={onGetStarted} className={GET_STARTED}>
              Get started
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4">
                <path d="M5 12h14m-6-6 6 6-6 6" />
              </svg>
            </button>
            <button type="button" onClick={onLearnMore} className={LEARN_MORE}>
              Learn more
            </button>
          </div>
        </div>
        <div className="lg:col-span-2">
          <HeroIllustration />
        </div>
      </div>
    </section>
  );
}
