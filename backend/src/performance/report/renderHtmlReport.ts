import { runnableJourneys, type PerformancePlan, type PerformanceResult, type PerformanceRun, type PerformanceStep, type RequestPhase, type StepResult, type TimelinePoint } from "@apipilot/shared-domain";

/**
 * The self-contained performance report (FR-035 to FR-040; specs/031-k6-performance-testing
 * research D17). One deterministic HTML document from the stored run: inline CSS with light and
 * dark styles, server-computed inline SVG, no JavaScript, and a Content-Security-Policy that lets
 * it load nothing. Every string is HTML-escaped, because path templates come from an uploaded
 * specification. Steps are identified by method and path template only; no value, token or body
 * is ever part of a run record, so none can appear here (FR-040).
 *
 * FR-036 (amended 2026-09-30): the timeline is three panels on one time axis, each with its own
 * scale, plus a per-step latency heatmap; each step shows every status it received, exact
 * min/mean/max latency and k6's request phases; and each step's provenance is split into a request
 * block (the template, never its values) and a response block (the measured outcome, never a body).
 * Hover text uses SVG `<title>` and the `title` attribute, so it needs no script. Figures that
 * runs recorded before the amendment lack are left out, not invented.
 */
export const REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Locale-free number formatting, so the same run renders the same bytes on every machine. */
export function formatCount(value: number): string {
  const [whole, fraction] = String(value).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function ms(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${formatCount(Math.round(value * 10) / 10)} ms`;
}

export function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value}%`;
}

export function bytes(value: number): string {
  if (value < 1024) return `${formatCount(value)} B`;
  const units = ["KiB", "MiB", "GiB"];
  let scaled = value / 1024;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${formatCount(Math.round(scaled * 10) / 10)} ${units[unit]}`;
}

export function clock(offsetMs: number): string {
  const total = Math.floor(offsetMs / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The smallest 1, 2 or 5 × 10ⁿ at or above `value`, so an axis ends on a readable number. */
export function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const fraction = value / magnitude;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return Number((step * magnitude).toPrecision(6));
}

const CHOICE_TEXT: Record<PerformanceStep["scenarioChoice"], string> = {
  "rule-generated": "rule-generated, preferred over AI-enhanced alternatives",
  "only-positive": "the operation's only positive scenario",
  "ai-enhanced-no-rule-alternative": "AI-enhanced; no rule-generated positive scenario exists",
};

const AUTH_TEXT: Record<PerformanceStep["auth"]["kind"], string> = {
  "oauth2-client-credentials": "OAuth2 client credentials",
  "chained-login": "Token from a login request",
  "static-credential": "Credential from the environment",
  none: "None",
};

export const PHASE_TEXT: Record<RequestPhase, string> = {
  blocked: "Blocked (waiting for a free connection)",
  connecting: "Connecting (TCP)",
  "tls-handshaking": "TLS handshake",
  sending: "Sending",
  waiting: "Waiting (time to first byte)",
  receiving: "Receiving",
};

function statusBadge(run: PerformanceRun): string {
  const labels: Record<PerformanceRun["status"], string> = {
    "in-progress": "In progress",
    completed: "Completed",
    cancelled: run.cancelReason === "backend-restart" ? "Cancelled · backend restart" : "Cancelled · by you",
    failed: `Failed · ${run.failure?.category ?? "unknown"}`,
  };
  const tone = run.status === "completed" ? "ok" : run.status === "failed" ? "bad" : "neutral";
  return `<span class="badge ${tone}">${escapeHtml(labels[run.status])}</span>`;
}

function statusText(status: string): string {
  return status === "0" ? "No response" : status;
}

interface StepRow {
  step: PerformanceStep;
  where: string;
  measured: StepResult | undefined;
  /** AP-035 FR-029: the journey's origin, for the step's provenance. */
  journey: PerformancePlan["journeys"][number];
}

function stepRowsOf(plan: PerformancePlan, result: PerformanceResult | undefined): StepRow[] {
  const byId = new Map((result?.steps ?? []).map((step) => [step.stepId, step]));
  // AP-035 FR-025: an incomplete user journey was not run, so it has no step in the report.
  return runnableJourneys(plan.journeys).flatMap((journey, journeyIndex) =>
    journey.steps.map((step, stepIndex) => ({ step, journey, where: `J${journeyIndex + 1} · step ${stepIndex + 1}`, measured: byId.get(step.id) })),
  );
}

function stepLabel(step: PerformanceStep): string {
  return `<span class="method">${escapeHtml(step.method)}</span> <code>${escapeHtml(step.path)}</code>`;
}

// ── Timeline ──────────────────────────────────────────────────────────────────────────────────

/** A tick every 5 s, 10 s, … 1 h, whichever first gives at most seven ticks. */
export function timeTickMs(totalMs: number): number {
  const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].map((seconds) => seconds * 1000);
  return steps.find((step) => totalMs / step <= 7) ?? Math.ceil(totalMs / 7 / 3_600_000) * 3_600_000;
}

interface Scale {
  y: (value: number) => number;
  ticks: { value: number; label: string }[];
  note: string;
}

/**
 * A log scale once the slowest bucket is 20 times the fastest, so one slow endpoint cannot flatten
 * every other bucket onto the baseline; a linear scale from 0 otherwise.
 */
export function latencyScale(values: number[], top: number, bottom: number): Scale {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (lo > 0 && hi / lo >= 20) {
    const from = Math.floor(Math.log10(lo));
    const to = Math.max(from + 1, Math.ceil(Math.log10(hi)));
    const every = Math.ceil((to - from) / 5);
    const ticks = [];
    for (let exponent = from; exponent <= to; exponent += every) {
      const value = Number((10 ** exponent).toPrecision(6));
      ticks.push({ value, label: ms(value) });
    }
    return { y: (value) => bottom - ((bottom - top) * (Math.log10(value) - from)) / (to - from), ticks, note: "ms, log scale" };
  }
  const max = niceCeil(hi);
  return { y: (value) => bottom - ((bottom - top) * value) / max, ticks: [0, max / 2, max].map((value) => ({ value, label: ms(value) })), note: "ms" };
}

export function countScale(max: number, top: number, bottom: number): Scale {
  const ceiling = niceCeil(Math.max(1, max));
  const values = Number.isInteger(ceiling / 2) ? [0, ceiling / 2, ceiling] : [0, ceiling];
  return { y: (value) => bottom - ((bottom - top) * value) / ceiling, ticks: values.map((value) => ({ value, label: formatCount(value) })), note: "" };
}

export function timelineSvg(points: TimelinePoint[], bucketMs: number): string {
  if (points.length === 0) return '<p class="muted">No timeline was recorded.</p>';
  const width = 1200;
  const left = 72;
  const right = 24;
  const panelHeight = 84;
  const gap = 46;
  const firstTop = 30;
  const tops = [0, 1, 2].map((index) => firstTop + index * (panelHeight + gap));
  const lastBottom = tops[2] + panelHeight;
  const height = lastBottom + 44;
  const columns = points[points.length - 1].offsetMs / bucketMs + 1;
  const totalMs = columns * bucketMs;
  const columnWidth = (width - left - right) / columns;
  const x = (offsetMs: number) => left + (offsetMs / bucketMs) * columnWidth;
  const middle = (offsetMs: number) => round1(x(offsetMs) + columnWidth / 2);

  const parts: string[] = [];
  const tickMs = timeTickMs(totalMs);
  for (let offset = 0; offset <= totalMs; offset += tickMs) {
    const at = round1(x(offset));
    for (const top of tops) parts.push(`<line class="grid" x1="${at}" y1="${top}" x2="${at}" y2="${top + panelHeight}"></line>`);
    parts.push(`<text class="axis" x="${at}" y="${lastBottom + 16}" text-anchor="middle">${clock(offset)}</text>`);
  }
  parts.push(`<text class="axis" x="${round1((width - left - right) / 2 + left)}" y="${lastBottom + 36}" text-anchor="middle">Elapsed time · each column is a ${clock(bucketMs)} interval</text>`);

  const axis = (scale: Scale, top: number) => {
    for (const tick of scale.ticks) {
      const at = round1(scale.y(tick.value));
      parts.push(`<line class="grid" x1="${left}" y1="${at}" x2="${width - right}" y2="${at}"></line>`);
      parts.push(`<text class="axis" x="${left - 8}" y="${round1(at + 4)}" text-anchor="end">${escapeHtml(tick.label)}</text>`);
    }
    parts.push(`<line class="baseline" x1="${left}" y1="${top + panelHeight}" x2="${width - right}" y2="${top + panelHeight}"></line>`);
  };
  const title = (top: number, entries: { swatch: string; text: string }[], aside: string) => {
    let at = left;
    for (const entry of entries) {
      parts.push(`<rect class="${entry.swatch}" x="${at}" y="${top - 21}" width="12" height="10" rx="2"></rect>`);
      parts.push(`<text class="panel-title" x="${at + 18}" y="${top - 12}">${escapeHtml(entry.text)}</text>`);
      at += 30 + entry.text.length * 7.4;
    }
    parts.push(`<text class="axis" x="${width - right}" y="${top - 12}" text-anchor="end">${escapeHtml(aside)}</text>`);
  };

  // 1. Virtual users.
  const maxVus = Math.max(0, ...points.map((point) => point.virtualUsers));
  const vusScale = countScale(maxVus, tops[0], tops[0] + panelHeight);
  axis(vusScale, tops[0]);
  const vusLine = points.map((point) => `${middle(point.offsetMs)},${round1(vusScale.y(point.virtualUsers))}`).join(" ");
  parts.push(`<polygon class="vus-area" points="${middle(points[0].offsetMs)},${tops[0] + panelHeight} ${vusLine} ${middle(points[points.length - 1].offsetMs)},${tops[0] + panelHeight}"></polygon>`);
  parts.push(`<polyline class="vus-line" points="${vusLine}"></polyline>`);
  title(tops[0], [{ swatch: "sw-vus", text: "Virtual users" }], `peak ${formatCount(maxVus)}`);

  // 2. p95 latency of every step together.
  const latencies = points.filter((point) => point.p95Ms !== null).map((point) => point.p95Ms!);
  let peakLatency = 0;
  if (latencies.length > 0) {
    const scale = latencyScale(latencies, tops[1], tops[1] + panelHeight);
    axis(scale, tops[1]);
    // A bucket with no measured latency breaks the line rather than being drawn as 0.
    const segments: string[][] = [[]];
    for (const point of points) {
      if (point.p95Ms === null) segments.push([]);
      else segments[segments.length - 1].push(`${middle(point.offsetMs)},${round1(scale.y(point.p95Ms))}`);
    }
    for (const segment of segments.filter((candidate) => candidate.length > 0)) parts.push(`<polyline class="p95" points="${segment.join(" ")}"></polyline>`);
    peakLatency = Math.max(...latencies);
    const peak = points.find((point) => point.p95Ms === peakLatency)!;
    parts.push(`<circle class="p95-dot" cx="${middle(peak.offsetMs)}" cy="${round1(scale.y(peakLatency))}" r="4"></circle>`);
    title(tops[1], [{ swatch: "sw-p95", text: "p95 latency, all steps" }], `peak ${ms(peakLatency)} at ${clock(peak.offsetMs)} · ${scale.note}`);
  } else {
    title(tops[1], [{ swatch: "sw-p95", text: "p95 latency, all steps" }], "no latency measured");
  }

  // 3. Requests per interval, split into responses as expected and failures.
  const maxRequests = Math.max(0, ...points.map((point) => point.requests));
  const requestScale = countScale(maxRequests, tops[2], tops[2] + panelHeight);
  axis(requestScale, tops[2]);
  const barWidth = round1(Math.max(1, columnWidth - 2));
  for (const point of points) {
    const bottom = tops[2] + panelHeight;
    const okHeight = round1(bottom - requestScale.y(point.requests - point.errors));
    const failedHeight = round1(bottom - requestScale.y(point.errors));
    const barX = round1(x(point.offsetMs) + 1);
    if (okHeight > 0) parts.push(`<rect class="bar-ok" x="${barX}" y="${round1(bottom - okHeight)}" width="${barWidth}" height="${okHeight}"></rect>`);
    if (failedHeight > 0) {
      const gapAbove = okHeight > 0 ? 2 : 0;
      parts.push(`<rect class="bar-fail" x="${barX}" y="${round1(bottom - okHeight - gapAbove - failedHeight)}" width="${barWidth}" height="${failedHeight}"></rect>`);
    }
  }
  const failingBuckets = points.filter((point) => point.errors > 0).length;
  title(
    tops[2],
    [
      { swatch: "sw-ok", text: "Requests as expected" },
      { swatch: "sw-fail", text: "Failed requests" },
    ],
    `most in one interval ${formatCount(maxRequests)} · ${failingBuckets} of ${points.length} intervals had failures`,
  );

  // Hover: one column per bucket across all three panels.
  for (const point of points) {
    const tip = `${clock(point.offsetMs)}–${clock(point.offsetMs + bucketMs)} · ${formatCount(point.virtualUsers)} VUs · p95 ${ms(point.p95Ms)} · ${formatCount(point.requests)} requests, ${formatCount(point.errors)} failed`;
    parts.push(`<rect class="hit" x="${round1(x(point.offsetMs))}" y="${tops[0] - 4}" width="${round1(columnWidth)}" height="${lastBottom - tops[0] + 8}"><title>${escapeHtml(tip)}</title></rect>`);
  }

  const summary = `Three panels on one time axis. Virtual users peak at ${formatCount(maxVus)}; p95 latency peaks at ${ms(peakLatency)}; ${failingBuckets} of ${points.length} time intervals have failures.`;
  return `<svg class="timeline" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(summary)}">${parts.join("")}</svg>`;
}

export function timelineTable(points: TimelinePoint[], bucketMs: number): string {
  if (points.length === 0) return "";
  const rows = points
    .map(
      (point) =>
        `<tr><td class="num">${clock(point.offsetMs)}–${clock(point.offsetMs + bucketMs)}</td><td class="num">${formatCount(point.virtualUsers)}</td><td class="num">${formatCount(point.requests)}</td><td class="num">${formatCount(point.errors)}</td><td class="num">${ms(point.p95Ms)}</td></tr>`,
    )
    .join("");
  return `<details class="data"><summary>Timeline as a table</summary><div class="scroll"><table><thead><tr><th>Interval</th><th class="num">Virtual users</th><th class="num">Requests</th><th class="num">Failed</th><th class="num">p95</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

/**
 * Each step's p95 per interval on one shared scale, five classes spaced evenly in log(latency)
 * between the fastest and slowest cell. Intervals with a failure are hatched as well as listed in
 * the cell's hover text, so failure is never shown by color alone.
 */
function stepHeatmap(rows: StepRow[], points: TimelinePoint[], bucketMs: number): string {
  if (!rows.some((row) => row.measured?.timeline)) return '<p class="muted small">This run was recorded before per-step timelines were kept.</p>';
  const lastOffset = Math.max(0, ...points.map((point) => point.offsetMs), ...rows.flatMap((row) => (row.measured?.timeline ?? []).map((point) => point.offsetMs)));
  const columns = lastOffset / bucketMs + 1;
  const values = rows.flatMap((row) => (row.measured?.timeline ?? []).flatMap((point) => (point.p95Ms === null ? [] : [point.p95Ms])));
  const lo = values.length > 0 ? Math.min(...values) : 0;
  const hi = values.length > 0 ? Math.max(...values) : 0;
  const spread = lo > 0 && hi / lo > 1.0001 ? Math.log(hi / lo) : 0;
  const classOf = (value: number) => (spread === 0 ? 3 : Math.min(5, 1 + Math.floor((5 * Math.log(value / lo)) / spread)));
  const edge = (index: number) => lo * Math.exp((spread * index) / 5);

  const chips =
    spread === 0
      ? [`<span class="chip"><span class="cell h3"></span>${escapeHtml(ms(hi))}</span>`]
      : [1, 2, 3, 4, 5].map((k) => `<span class="chip"><span class="cell h${k}"></span>${escapeHtml(`${ms(edge(k - 1))} – ${ms(edge(k))}`)}</span>`);
  const legend = [
    '<div class="hm-legend"><span class="muted">p95 latency per interval</span>',
    ...chips,
    '<span class="chip"><span class="cell h3 fail"></span>Hatched: had failures</span>',
    '<span class="chip"><span class="cell empty"></span>No requests</span>',
    "</div>",
  ].join("");

  const body = rows
    .map((row) => {
      const byIndex = new Map((row.measured?.timeline ?? []).map((point) => [point.offsetMs / bucketMs, point]));
      const cells: string[] = [];
      for (let index = 0; index < columns; index += 1) {
        const point = byIndex.get(index);
        if (!point) {
          cells.push('<span class="cell empty"></span>');
          continue;
        }
        const tone = point.p95Ms === null ? "empty" : `h${classOf(point.p95Ms)}`;
        const tip = `${row.step.method} ${row.step.path} · ${clock(point.offsetMs)}–${clock(point.offsetMs + bucketMs)} · ${formatCount(point.requests)} requests · p95 ${ms(point.p95Ms)} · ${formatCount(point.errors)} failed`;
        cells.push(`<span class="cell ${tone}${point.errors > 0 ? " fail" : ""}" title="${escapeHtml(tip)}"></span>`);
      }
      const measured = row.measured;
      const sent = measured !== undefined && measured.requests > 0;
      const sum = sent ? `${ms(measured.latencyMs?.p95)}<div class="small ${measured.errorRatePercent > 0 ? "fail-text" : "muted"}">${pct(measured.errorRatePercent)} failed</div>` : '<span class="muted">not sent</span>';
      return `<div class="hm-row"><div class="hm-label">${stepLabel(row.step)} <span class="muted small">${row.where}</span></div><div class="hm-cells" style="grid-template-columns:repeat(${columns},minmax(0,1fr))" aria-hidden="true">${cells.join("")}</div><div class="hm-sum num">${sum}</div></div>`;
    })
    .join("");
  return `${legend}<div class="scroll"><div class="hm"><div class="hm-row hm-head"><div class="hm-label muted small">Step</div><div class="hm-axis small muted"><span>00:00</span><span>${clock(columns * bucketMs)}</span></div><div class="hm-sum muted small">p95 · failed</div></div>${body}</div></div>`;
}

// ── By step ──────────────────────────────────────────────────────────────────────────────────

/** Every status the step received; for a run recorded before the amendment, its failure statuses only. */
function receivedStatuses(measured: StepResult | undefined): string {
  if (!measured || measured.requests === 0) return '<span class="muted">—</span>';
  if (measured.statusesReceived) {
    return measured.statusesReceived
      .map(
        (entry) =>
          `<div class="st"><span class="nowrap">${escapeHtml(statusText(entry.status))} × ${formatCount(entry.count)}</span> <span class="badge ${entry.expected ? "ok" : "bad"}">${entry.expected ? "expected" : "unexpected"}</span></div>`,
      )
      .join("");
  }
  const failures = measured.errorsByStatus.map((entry) => `<div class="st"><span class="nowrap">${escapeHtml(statusText(entry.status))} × ${formatCount(entry.count)}</span> <span class="badge bad">unexpected</span></div>`).join("");
  return `${failures || '<span class="muted">No failures</span>'}<div class="muted small">Failures only; this run predates recording every status.</div>`;
}

function failureCategories(measured: StepResult | undefined): string {
  const text = measured?.errorsByCategory.map((entry) => `${entry.category} × ${formatCount(entry.count)}`).join(", ");
  return text ? escapeHtml(text) : '<span class="muted">—</span>';
}

function notSentText(measured: StepResult | undefined): string {
  const notSent = [
    measured && measured.notAttempted.missingData > 0 ? `Missing data (${escapeHtml(measured.missingVariables.join(", "))}) × ${formatCount(measured.notAttempted.missingData)}` : "",
    measured && measured.notAttempted.dependencyNotAttempted > 0 ? `Dependency not attempted × ${formatCount(measured.notAttempted.dependencyNotAttempted)}` : "",
  ]
    .filter(Boolean)
    .join("<br>");
  return notSent || "—";
}

function stepTableRows(rows: StepRow[]): string {
  return rows
    .map(({ step, where, measured }) => {
      const sent = measured !== undefined && measured.requests > 0;
      const edited = [step.bodyEdited ? BODY_EDITED_MARKER : "", step.parametersEdited ? PARAMETERS_EDITED_MARKER : ""]
        .filter(Boolean)
        .map((marker) => ` · ${marker}`)
        .join("");
      return [
        `<tr${sent && measured.errorRatePercent > 0 ? ' class="failing"' : ""}>`,
        `<td class="step">${stepLabel(step)}<div class="muted small">${where}${edited}</div></td>`,
        `<td><code>${escapeHtml(step.expectedStatuses.map((status) => status.code).join(", ") || "—")}</code></td>`,
        `<td class="small">${receivedStatuses(measured)}</td>`,
        `<td class="num">${formatCount(measured?.requests ?? 0)}</td>`,
        `<td class="num">${sent ? formatCount(measured.throughputPerSecond) : "—"}</td>`,
        `<td class="num">${sent ? pct(measured.errorRatePercent) : "—"}</td>`,
        `<td class="num">${ms(measured?.latencySummaryMs?.min)}</td>`,
        `<td class="num">${ms(measured?.latencyMs?.p50)}</td>`,
        `<td class="num">${ms(measured?.latencyMs?.p90)}</td>`,
        `<td class="num">${ms(measured?.latencyMs?.p95)}</td>`,
        `<td class="num">${ms(measured?.latencyMs?.p99)}</td>`,
        `<td class="num">${ms(measured?.latencySummaryMs?.max)}</td>`,
        `<td class="small">${failureCategories(measured)}</td>`,
        `<td class="num">${pct(measured?.checkPassRatePercent ?? null)}</td>`,
        `<td class="small">${notSentText(measured)}</td>`,
        "</tr>",
      ].join("");
    })
    .join("");
}

// ── Request and response by step (provenance) ────────────────────────────────────────────────

/** AP-035 FR-029: where a capture's value comes from, by field path or header name. Never the value. */
function captureSourceText(source: NonNullable<PerformanceStep["captures"]>[number]["source"]): string {
  return source.kind === "body" ? `response field ${source.path}` : `response header ${source.name}`;
}

function requestBlock(step: PerformanceStep, stepsById: Map<string, PerformanceStep>): string {
  const sends = step.bindings
    ? step.bindings.map((binding) => {
        const producer = stepsById.get(binding.captureStepId);
        const capture = producer?.captures?.find((candidate) => candidate.name === binding.captureName);
        const target = binding.target.kind === "body" ? `body ${binding.target.fieldPath}` : `${binding.target.kind} ${binding.target.name}`;
        const missing = binding.state === "target-missing" ? " (target no longer exists)" : "";
        return `${target} ← captured ${binding.captureName}, from ${producer?.operationKey ?? "an earlier step"}${capture ? ` (${captureSourceText(capture.source)})` : ""}${missing}`;
      })
    : step.variableBindings
        .filter((binding) => binding.role !== "produces")
        .map((binding) => `${binding.variable} → ${binding.location} ${binding.field}, from ${stepsById.get(binding.producerStepId ?? "")?.operationKey ?? "an earlier step"}`);
  const body = step.bodyEdited ? `${BODY_EDITED_MARKER} · its content is not recorded` : "Not recorded";
  // AP-033 FR-022: which parameters were sent is in the plan's request preview; their values are never recorded.
  const parameters = step.parametersEdited ? `${PARAMETERS_EDITED_MARKER} · their values are not recorded` : "As generated · values are not recorded";
  return [
    '<section class="rr-box" aria-label="Request">',
    "<h3>Request</h3>",
    "<dl>",
    `<dt>Request</dt><dd>${stepLabel(step)} <span class="muted small">path template; the resolved URL is not recorded</span></dd>`,
    `<dt>Authentication</dt><dd>${escapeHtml(AUTH_TEXT[step.auth.kind])}${step.auth.schemeName ? ` (${escapeHtml(step.auth.schemeName)})` : ""}</dd>`,
    `<dt>Sends from earlier steps</dt><dd>${escapeHtml(sends.join("; ") || "Nothing")}</dd>`,
    `<dt>Values you supply</dt><dd>${step.requiredValues.length > 0 ? step.requiredValues.map((name) => `<code>${escapeHtml(name)}</code>`).join(", ") : "None"}</dd>`,
    `<dt>Parameters</dt><dd>${escapeHtml(parameters)}</dd>`,
    `<dt>Body</dt><dd>${escapeHtml(body)}</dd>`,
    "</dl>",
    "</section>",
  ].join("");
}

export function phaseTable(measured: StepResult): string {
  if (!measured.phaseTimings || measured.phaseTimings.length === 0) return "";
  const rows = measured.phaseTimings.map((timing) => `<tr><td>${escapeHtml(PHASE_TEXT[timing.phase])}</td><td class="num">${ms(timing.meanMs)}</td><td class="num">${ms(timing.p95Ms)}</td></tr>`).join("");
  return `<dt>Request phases</dt><dd><table class="phases"><thead><tr><th>Phase</th><th class="num">Mean</th><th class="num">p95</th></tr></thead><tbody>${rows}</tbody></table></dd>`;
}

function responseBlock(step: PerformanceStep, measured: StepResult | undefined): string {
  const expected = step.expectedStatuses.map((status) => `${status.code} (${status.source === "specification" ? "from specification" : "set by you"})`).join(", ");
  const counts = new Map((measured?.captures ?? []).map((entry) => [entry.name, entry]));
  const countText = (name: string) => {
    const entry = counts.get(name);
    return entry ? ` (captured × ${formatCount(entry.succeeded)}, failed × ${formatCount(entry.failed)})` : "";
  };
  const extracts = step.captures
    ? step.captures.map((capture) => `${capture.name} ← ${captureSourceText(capture.source)}${countText(capture.name)}`)
    : step.variableBindings.filter((binding) => binding.role === "produces").map((binding) => `${binding.variable} ← response field ${binding.field}${countText(binding.variable)}`);
  const extractionFailed = measured?.errorsByCategory.find((entry) => entry.category === "extraction-failed")?.count ?? 0;
  const head = ['<section class="rr-box" aria-label="Response">', "<h3>Response</h3>", "<dl>", `<dt>Expected status</dt><dd>${escapeHtml(expected || "None")}</dd>`];
  const extractText = extracts.length === 0 ? "Nothing" : `${extracts.join("; ")}${extractionFailed > 0 ? ` · extraction failed × ${formatCount(extractionFailed)}` : ""}`;
  if (!measured || measured.requests === 0) {
    return [...head, `<dt>Extracts</dt><dd>${escapeHtml(extractText)}</dd>`, '<dt>Measured</dt><dd class="muted">No request was sent, so no response was measured.</dd>', "</dl>", "</section>"].join("");
  }
  const summary = measured.latencySummaryMs;
  const latency = measured.latencyMs;
  return [
    ...head,
    `<dt>Received</dt><dd>${receivedStatuses(measured)}</dd>`,
    `<dt>Failures</dt><dd>${measured.errorRatePercent > 0 ? `${pct(measured.errorRatePercent)} · ${failureCategories(measured)}` : "None"}</dd>`,
    `<dt>Latency</dt><dd class="num-inline">${summary ? `min ${ms(summary.min)} · mean ${ms(summary.mean)} · max ${ms(summary.max)}<br>` : ""}${latency ? `p50 ${ms(latency.p50)} · p90 ${ms(latency.p90)} · p95 ${ms(latency.p95)} · p99 ${ms(latency.p99)}` : "—"}</dd>`,
    phaseTable(measured),
    `<dt>Throughput</dt><dd>${formatCount(measured.throughputPerSecond)} requests/s · ${formatCount(measured.requests)} requests</dd>`,
    `<dt>Extracts</dt><dd>${escapeHtml(extractText)}</dd>`,
    `<dt>Checks passed</dt><dd>${pct(measured.checkPassRatePercent)}</dd>`,
    unexpectedHint(measured),
    "</dl>",
    "</section>",
  ].join("");
}

/**
 * AP-033 FR-022: a step that received unexpected statuses points to where its request can be seen
 * and changed. The report has no values to compare, so it says where they are, not what they were.
 */
export const UNEXPECTED_STATUS_HINT =
  "The server answered with a status this step does not expect. Open the step's Request in the plan to see the parameters, headers and body it sends, and edit them there.";

function unexpectedHint(measured: StepResult): string {
  const unexpected = measured.statusesReceived
    ? measured.statusesReceived.some((entry) => !entry.expected && entry.status !== "0")
    : measured.errorsByStatus.some((entry) => entry.status !== "0");
  return unexpected ? `<dt>What to check</dt><dd>${escapeHtml(UNEXPECTED_STATUS_HINT)}</dd>` : "";
}

function stepBlocks(rows: StepRow[]): string {
  const stepsById = new Map(rows.map((row) => [row.step.id, row.step]));
  const failing = (row: StepRow) => row.measured !== undefined && row.measured.errorRatePercent > 0;
  // Open the steps that failed, so the reason is on screen; with none, open the first step.
  const anyFailing = rows.some(failing);
  return rows
    .map((row, index) => {
      const { step, measured, journey } = row;
      const relationships = step.dependency
        ? ` · relationships ${step.dependency.relationshipIds.map((id) => id.slice(0, 12)).join(", ")} (${step.dependency.confidence})`
        : "";
      // AP-035 FR-029 (AP-029 FR-039): whether the step is in a proposed or a user-defined journey.
      const why =
        journey.source.kind === "user"
          ? `${journey.source.basedOnWorkflowId ? `In a journey based on workflow ${journey.source.basedOnWorkflowId.slice(0, 12)}, edited by you` : "In a journey defined by you"}: ${journey.source.name}${relationships}`
          : step.dependency
            ? `${step.produces.length > 0 ? `Produces ${step.produces.join(", ")}` : `Consumes ${step.consumes.join(", ")}`}${relationships}`
            : "A single operation in scope";
      const received = measured?.statusesReceived?.map((entry) => `${statusText(entry.status)} × ${formatCount(entry.count)}`).join(", ");
      const glance = measured && measured.requests > 0 ? `${received ? `${received} · ` : ""}p95 ${ms(measured.latencyMs?.p95)} · ${pct(measured.errorRatePercent)} failed` : "not sent";
      const open = anyFailing ? failing(row) : index === 0;
      return [
        `<details${open ? " open" : ""}>`,
        `<summary>${stepLabel(step)} <span class="muted">${row.where}</span> <span class="glance${failing(row) ? " fail-text" : ""}">${escapeHtml(glance)}</span></summary>`,
        '<div class="rr">',
        requestBlock(step, stepsById),
        responseBlock(step, measured),
        "</div>",
        '<dl class="why">',
        `<dt>Why in this journey</dt><dd>${escapeHtml(why)}</dd>`,
        `<dt>Scenario</dt><dd>${escapeHtml(step.scenarioDescription)} · ${escapeHtml(CHOICE_TEXT[step.scenarioChoice])}${step.tieBrokenByLowestId ? " (lowest id among equals)" : ""}</dd>`,
        "</dl>",
        "</details>",
      ].join("");
    })
    .join("");
}

function thresholdRows(run: PerformanceRun, result: PerformanceResult): string {
  const plan = run.planSnapshot;
  if (plan.thresholds.length === 0) return '<p>No thresholds were set, so the report gives no pass/fail verdict.</p>';
  const outcomes = new Map(result.thresholdOutcomes.map((outcome) => [outcome.thresholdId, outcome]));
  const operationKey = (stepId: string) => plan.journeys.flatMap((j) => j.steps).find((s) => s.id === stepId)?.operationKey ?? stepId;
  const failed = result.thresholdOutcomes.filter((outcome) => !outcome.passed).length;
  const rows = plan.thresholds
    .map((threshold) => {
      const outcome = outcomes.get(threshold.id);
      const where = threshold.scope.kind === "run" ? "Run" : operationKey(threshold.scope.stepId);
      const unit = threshold.metric === "error-rate" ? "%" : " ms";
      const label = `${where} ${threshold.metric === "error-rate" ? "failure rate" : threshold.metric} ≤ ${threshold.limit}${unit}`;
      const measured = outcome?.measured === null || outcome?.measured === undefined ? "—" : `${formatCount(outcome.measured)}${unit}`;
      const verdict = outcome?.passed ? '<span class="badge ok">Passed</span>' : '<span class="badge bad">Failed</span>';
      return `<tr><td>${escapeHtml(label)}</td><td class="num">${escapeHtml(measured)}</td><td>${verdict}</td></tr>`;
    })
    .join("");
  return `<p>${failed} of ${plan.thresholds.length} failed. Set by you before the run; ApiPilot proposes no targets.</p><table><thead><tr><th>Threshold</th><th class="num">Measured</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function tiles(result: PerformanceResult): string {
  const t = result.totals;
  const tile = (key: string, value: string, note = "") => `<div class="tile"><div class="k">${key}</div><div class="v">${value}</div>${note ? `<div class="small muted">${note}</div>` : ""}</div>`;
  return [
    '<div class="tiles">',
    tile("Requests", formatCount(t.requests)),
    tile("Throughput", `${formatCount(t.throughputPerSecond)}/s`),
    tile("Failure rate", pct(t.errorRatePercent), `${formatCount(t.errors)} failures`),
    tile("p50 latency", ms(t.latencyMs?.p50)),
    tile("p95 latency", ms(t.latencyMs?.p95)),
    tile("p99 latency", ms(t.latencyMs?.p99)),
    t.latencySummaryMs ? tile("Max latency", ms(t.latencySummaryMs.max), `min ${ms(t.latencySummaryMs.min)} · mean ${ms(t.latencySummaryMs.mean)}`) : "",
    tile("Iterations", formatCount(t.iterations), t.iterationDurationMs ? `p95 ${ms(t.iterationDurationMs.p95)} each` : ""),
    tile("Journeys cut short", formatCount(t.journeysCutShort)),
    t.dataReceivedBytes !== undefined ? tile("Data received", bytes(t.dataReceivedBytes), `${bytes(t.dataSentBytes ?? 0)} sent`) : "",
    "</div>",
  ].join("");
}

/*
 * Chart colors (validated with the dataviz palette checker against both surfaces): aqua for
 * virtual users, blue for latency, a neutral gray for requests as expected, and red, the status
 * color, for failures only. The heatmap is one blue ramp, lighter to darker in light mode and
 * darker to lighter in dark mode, so low latency recedes toward the surface in both.
 */
export const STYLE = `
:root{--bg:#ffffff;--fg:#17231f;--muted:#56675f;--border:#d8e4df;--chrome:#f7faf8;--ok-bg:#dcfce7;--ok-fg:#15803d;--bad-bg:#fee2e2;--bad-fg:#b91c1c;--neutral-bg:#eef2f0;--neutral-fg:#334155;--vus:#1baf7a;--vus-fill:rgba(27,175,122,.16);--p95:#2a78d6;--bar-ok:#a9b6b1;--fail:#d03b3b;--baseline:#b7c6c0;--hover:rgba(23,35,31,.06);--h1:#cde2fb;--h2:#9ec5f4;--h3:#5598e7;--h4:#256abf;--h5:#104281}
@media (prefers-color-scheme: dark){:root{--bg:#121d1a;--fg:#e4efeb;--muted:#95aaa2;--border:#263b35;--chrome:#0c1714;--ok-bg:rgba(34,197,94,.16);--ok-fg:#dcfce7;--bad-bg:rgba(239,68,68,.16);--bad-fg:#fee2e2;--neutral-bg:rgba(100,116,139,.18);--neutral-fg:#f1f5f9;--vus:#199e70;--vus-fill:rgba(25,158,112,.22);--p95:#3987e5;--bar-ok:#51625c;--fail:#e05252;--baseline:#3a524a;--hover:rgba(228,239,235,.07);--h1:#104281;--h2:#1c5cab;--h3:#2a78d6;--h4:#6da7ec;--h5:#b7d3f6}}
*{box-sizing:border-box}body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:14px/1.45 "IBM Plex Sans","Segoe UI",system-ui,sans-serif}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px}h3{font-size:13px;margin:0 0 6px}code,.method,.num{font-family:"JetBrains Mono","Cascadia Code",Consolas,monospace}
.muted{color:var(--muted)}.small{font-size:12px}.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.nowrap{white-space:nowrap}.fail-text{color:var(--bad-fg)}
.badge{display:inline-block;border-radius:999px;padding:1px 8px;font-size:12px;font-weight:600}.ok{background:var(--ok-bg);color:var(--ok-fg)}.bad{background:var(--bad-bg);color:var(--bad-fg)}.neutral{background:var(--neutral-bg);color:var(--neutral-fg)}
.method{font-weight:600;font-size:12px}
.meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px 24px;margin:16px 0}.meta dt{font-size:12px;font-weight:600;color:var(--muted)}.meta dd{margin:0}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}.tile{border:1px solid var(--border);border-radius:8px;background:var(--chrome);padding:12px 14px}.tile .k{font-size:12px;font-weight:600;color:var(--muted)}.tile .v{font:600 20px "JetBrains Mono",Consolas,monospace}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;font-size:12px;color:var(--muted);background:var(--chrome);padding:7px 9px;border-bottom:1px solid var(--border)}td{padding:8px 9px;border-bottom:1px solid var(--border);vertical-align:top}
td.step code{white-space:nowrap}tr.failing td:first-child{box-shadow:inset 3px 0 0 var(--fail)}.st{margin:0 0 3px}
.scroll{overflow-x:auto}svg{width:100%;height:auto;display:block}
.grid{stroke:var(--border);stroke-width:1}.baseline{stroke:var(--baseline);stroke-width:1}.axis{fill:var(--muted);font:11px "JetBrains Mono",Consolas,monospace}.panel-title{fill:var(--fg);font:600 12px "IBM Plex Sans","Segoe UI",system-ui,sans-serif}
.vus-area{fill:var(--vus-fill)}.vus-line{fill:none;stroke:var(--vus);stroke-width:2}.p95{fill:none;stroke:var(--p95);stroke-width:2}.p95-dot{fill:var(--p95);stroke:var(--bg);stroke-width:2}.bar-ok{fill:var(--bar-ok)}.bar-fail{fill:var(--fail)}
.sw-vus{fill:var(--vus)}.sw-p95{fill:var(--p95)}.sw-ok{fill:var(--bar-ok)}.sw-fail{fill:var(--fail)}.hit{fill:transparent}.hit:hover{fill:var(--hover)}
details.data{margin-top:8px}
.hm-legend{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:12px;margin:0 0 8px}.chip{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.hm{min-width:760px}.hm-row{display:grid;grid-template-columns:minmax(200px,280px) minmax(0,1fr) 96px;gap:10px;align-items:center;padding:3px 0;border-bottom:1px solid var(--border)}.hm-head{border-bottom:1px solid var(--border)}
.hm-label{overflow-wrap:anywhere;font-size:12px}.hm-cells{display:grid;gap:1px}.hm-axis{display:flex;justify-content:space-between}.hm-sum{font-size:12px}
.cell{display:inline-block;height:16px;min-width:1px;border-radius:2px}.chip .cell{width:14px;height:12px}.hm-cells .cell{display:block}
.h1{background-color:var(--h1)}.h2{background-color:var(--h2)}.h3{background-color:var(--h3)}.h4{background-color:var(--h4)}.h5{background-color:var(--h5)}.empty{background-color:var(--chrome);box-shadow:inset 0 0 0 1px var(--border)}
.cell.fail{background-image:repeating-linear-gradient(135deg,var(--fail) 0 2px,transparent 2px 5px)}
ol.findings{padding-left:20px;margin:0}ol.findings li{margin:6px 0}
details{border-top:1px solid var(--border);padding:8px 0}summary{cursor:pointer}.glance{font-size:12px;margin-left:6px;color:var(--muted)}.glance.fail-text{color:var(--bad-fg)}
.rr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:12px;margin:10px 0 0 20px}.rr-box{border:1px solid var(--border);border-radius:8px;background:var(--chrome);padding:10px 12px;min-width:0}
details dl{display:grid;grid-template-columns:150px minmax(0,1fr);gap:4px 14px;margin:0}details dl.why{margin:10px 0 0 20px}details dt{color:var(--muted);font-size:12px;font-weight:600}details dd{margin:0;min-width:0;overflow-wrap:anywhere}
table.phases{font-size:12px}table.phases th,table.phases td{padding:3px 6px}
@media (max-width:760px){body{padding:16px}.meta{grid-template-columns:repeat(2,minmax(0,1fr))}.rr{grid-template-columns:minmax(0,1fr);margin-left:0}details dl,details dl.why{grid-template-columns:minmax(0,1fr);margin-left:0}}
`;

/** Renders the report from a stored run. Deterministic for the same run record. */
export function renderHtmlReport(run: PerformanceRun): string {
  const plan = run.planSnapshot;
  const result = run.result;
  const profile = plan.loadProfile.stages.map((stage) => `${Math.round(stage.durationMs / 1000)} s → ${stage.targetVirtualUsers}`).join(", ");
  const head = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>ApiPilot performance report · run ${escapeHtml(run.id.slice(0, 8))}</title>`,
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    `<h1>Performance report · run ${escapeHtml(run.id.slice(0, 8))} ${statusBadge(run)}</h1>`,
    '<p class="muted small">Generated by ApiPilot from the stored run. Latency percentiles are within 1%; minimum, mean and maximum are exact. No request or response bodies, tokens or resolved URLs are recorded, so each step\'s request and response show its template and what was measured, never its content.</p>',
    '<dl class="meta">',
    `<div><dt>Environment</dt><dd>${escapeHtml(run.environment.name)} <span class="badge neutral">Tier: ${escapeHtml(run.environment.tier)}</span></dd><dd><code>${escapeHtml(run.environment.baseUrl)}</code></dd></div>`,
    `<div><dt>Load profile</dt><dd>${escapeHtml(plan.loadProfile.kind)} · ${escapeHtml(profile)}</dd><dd class="small muted">Think time ${plan.thinkTimeMs / 1000} s</dd></div>`,
    `<div><dt>Started · ended</dt><dd><code>${escapeHtml(run.startedAt)}</code></dd><dd><code>${escapeHtml(run.endedAt ?? "—")}</code></dd></div>`,
    `<div><dt>k6 · script</dt><dd><code>v${escapeHtml(run.k6Version)} · sha256 ${escapeHtml(run.scriptSha256.slice(0, 12))}</code></dd></div>`,
    "</dl>",
  ];
  const rows = stepRowsOf(plan, result);
  if (!result) {
    return [...head, `<p>This run recorded no measurements${run.failure ? ` (failure: ${escapeHtml(run.failure.category)})` : ""}.</p>`, provenanceSection(plan, rows), "</body>", "</html>", ""].join("\n");
  }
  const { points, bucketMs } = result.timeline;
  const body = [
    tiles(result),
    "<h2>Thresholds</h2>",
    thresholdRows(run, result),
    "<h2>Findings</h2>",
    result.findings.length === 0 ? "<p>No rule produced a finding for this run.</p>" : `<ol class="findings">${result.findings.map((finding) => `<li>${escapeHtml(finding.message)}</li>`).join("")}</ol>`,
    "<h2>Timeline</h2>",
    '<p class="small muted">Each panel has its own scale. Hover over an interval for its figures.</p>',
    timelineSvg(points, bucketMs),
    timelineTable(points, bucketMs),
    "<h2>By step over time</h2>",
    stepHeatmap(rows, points, bucketMs),
    "<h2>By step</h2>",
    '<div class="scroll"><table><thead><tr><th>Step</th><th>Expected</th><th>Received</th><th class="num">Requests</th><th class="num">Req/s</th><th class="num">Failure rate</th><th class="num">Min</th><th class="num">p50</th><th class="num">p90</th><th class="num">p95</th><th class="num">p99</th><th class="num">Max</th><th>Failure category</th><th class="num">Checks passed</th><th>Not sent</th></tr></thead>',
    `<tbody>${stepTableRows(rows)}</tbody></table></div>`,
    '<p class="small muted">A response is a failure only when its status is not among the step\'s expected codes, or when there is no response. Failed extractions are listed but not counted in the failure rate. Token requests are not counted in any step.</p>',
    "<h2>What the run changed on the target</h2>",
    result.writeRequests.length === 0
      ? "<p>No write requests were sent.</p>"
      : `<table><thead><tr><th>Write operation</th><th class="num">Sent</th><th class="num">Succeeded</th></tr></thead><tbody>${result.writeRequests.map((entry) => `<tr><td><span class="method">${escapeHtml(entry.method)}</span> <code>${escapeHtml(entry.operationKey.slice(entry.operationKey.indexOf(" ") + 1))}</code></td><td class="num">${formatCount(entry.sent)}</td><td class="num">${formatCount(entry.succeeded)}</td></tr>`).join("")}</tbody></table><p class="small muted">ApiPilot does not clean up anything a run creates.</p>`,
    "<h2>Token refreshes</h2>",
    `<p>${formatCount(result.tokenRefreshes.count)} refreshes, ${formatCount(result.tokenRefreshes.failed)} failed. ${result.tokenRefreshes.lifetimeStated ? "Each virtual user refreshed its own token before its stated lifetime ended." : "A token had no stated lifetime, so it was not refreshed."}${result.tokenRefreshes.bucketOffsetsMs.length > 0 ? ` Refreshes at ${result.tokenRefreshes.bucketOffsetsMs.map(clock).join(", ")}.` : ""}</p>`,
    provenanceSection(plan, rows),
  ];
  return [...head, ...body, "</body>", "</html>", ""].join("\n");
}

/** AP-032 FR-013: a quick plan's report says its scenarios were generated and never reviewed. */
export const QUICK_PLAN_PROVENANCE = "Plan built by the quick performance test from generated positive scenarios that were not reviewed.";

/** AP-033 FR-014: the marker on a step that sent an engineer-written body. The body itself is never recorded. */
export const BODY_EDITED_MARKER = "Body edited by you";

/** AP-033 FR-022 (amended 2026-09-30): the marker on a step that sent parameters the engineer edited. Their values are never recorded. */
export const PARAMETERS_EDITED_MARKER = "Parameters edited by you";

/** AP-033 FR-022: how many steps sent parameters the engineer edited. */
export function parameterEditProvenance(count: number): string {
  const steps = count === 1 ? "1 step" : `${count} steps`;
  return `${steps} sent parameters edited by the engineer, not generated from the specification.`;
}

/** AP-033 FR-014 (constitution XI, XIII): how many steps sent a body the engineer wrote. */
export function bodyEditProvenance(count: number): string {
  const steps = count === 1 ? "1 step" : `${count} steps`;
  return `${steps} sent a body written by the engineer, not generated from the specification.`;
}

function provenanceSection(plan: PerformancePlan, rows: StepRow[]): string {
  // A snapshot recorded before AP-032 has no `source`; it came from the guided workflow.
  const quick = plan.source === "quick" ? `<p>${escapeHtml(QUICK_PLAN_PROVENANCE)}</p>` : "";
  const editedCount = plan.journeys.reduce((total, journey) => total + journey.steps.filter((step) => step.bodyEdited).length, 0);
  const edited = editedCount > 0 ? `<p>${escapeHtml(bodyEditProvenance(editedCount))}</p>` : "";
  const parameterCount = plan.journeys.reduce((total, journey) => total + journey.steps.filter((step) => step.parametersEdited).length, 0);
  const parametersEdited = parameterCount > 0 ? `<p>${escapeHtml(parameterEditProvenance(parameterCount))}</p>` : "";
  const intro = '<p class="small muted">Per step: the request as planned and the response as measured. Steps with failures are open.</p>';
  return `<h2>Provenance · request and response by step</h2>${quick}${edited}${parametersEdited}${intro}${stepBlocks(rows)}`;
}
