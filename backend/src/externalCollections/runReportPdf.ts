import PDFDocument from "pdfkit";
import {
  REASON_EXPLANATION,
  REPORT_METHOD_COLOURS,
  buildRunInsights,
  formatReportTime,
  type RunReportModel,
  type RunReportRow,
} from "./runReport";
import { NO_REQUESTS_NOTE, buildSeriesChart, layoutSeriesChart, type ChartBox, type SeriesChart } from "./runSeriesChart";

type Doc = InstanceType<typeof PDFDocument>;

/**
 * One block inside a card. It draws itself at (x, y) within width `w` and returns the height it
 * used, so the same function both measures (on a scratch document) and draws.
 */
type Item = (d: Doc, x: number, y: number, w: number) => number;

/** Layout, in PDF points (A4 is 595 x 842). */
const PAGE_WIDTH = 595;
const MARGIN = 48;
const FOOTER_RESERVE = 36;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const PAD = 12;
const GAP = 14;
const RADIUS = 6;
const BADGE_WIDTH = 40;
const BADGE_HEIGHT = 13;

/** The HTML report's light palette, so the two read as one design. */
const INK = "#0f172a";
const MUTED = "#475569";
const BORDER = "#e1e7ef";
const STRONG = "#eaeff5";
const ACCENT = "#0e6a8a";
const PASS = "#15803d";
const FAIL = "#dc2626";
const SKIP = "#64748b";
const WARN = "#b45309";

const OUTCOME_COLOUR: Record<RunReportRow["outcome"], string> = {
  Passed: PASS,
  Failed: FAIL,
  "Not attempted": SKIP,
};

/**
 * Characters above U+00FF that the standard fonts (WinAnsi encoding) can still draw: the typographic
 * dashes and quotes, the bullet, the ellipsis and a few more. Request names routinely use them
 * (an em dash in "GET /health — positive"), so they must not be replaced.
 */
const WIN_ANSI_EXTRAS = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ",
);

/**
 * The PDF uses the standard Helvetica font, which draws Latin-1 and the WinAnsi extras above. Other
 * text (and control characters) would otherwise be drawn as garbage, so it is replaced by `?` rather
 * than silently dropped; names in other scripts are therefore shown approximately in the report.
 */
export function toPdfText(text: string): string {
  let out = "";
  for (const char of text.replace(/[\r\n\t]+/g, " ")) {
    const code = char.codePointAt(0) ?? 63;
    const drawable = (code >= 32 && code <= 255 && code !== 127) || WIN_ANSI_EXTRAS.has(char);
    out += drawable ? char : "?";
  }
  return out;
}

const SEP = "  ·  ";

/** Draws wrapped text at an explicit position and returns the height it takes. */
function block(
  d: Doc,
  text: string,
  x: number,
  y: number,
  w: number,
  style: { font?: string; size: number; colour: string; align?: "left" | "right" | "center"; oneLine?: boolean },
): number {
  d.font(style.font ?? "Helvetica").fontSize(style.size);
  const options = { width: w, align: style.align ?? "left", lineBreak: !style.oneLine };
  const height = style.oneLine ? style.size * 1.2 : d.heightOfString(text, options);
  d.fillColor(style.colour).text(text, x, y, options);
  return height;
}

/** The method as a coloured label, in the same colours as the app and the HTML report. */
function methodBadge(d: Doc, method: string, x: number, y: number): void {
  const colour = REPORT_METHOD_COLOURS[method] ?? { fill: STRONG, text: INK };
  d.roundedRect(x, y, BADGE_WIDTH, BADGE_HEIGHT, 3).fill(colour.fill);
  block(d, toPdfText(method), x, y + 3, BADGE_WIDTH, { font: "Helvetica-Bold", size: 7, colour: colour.text, align: "center", oneLine: true });
}

function divider(d: Doc, x: number, y: number, w: number): void {
  d.moveTo(x, y).lineTo(x + w, y).strokeColor(BORDER).lineWidth(0.5).stroke();
}

const CHART_LEFT = 30;
const CHART_PLOT_HEIGHT = 110;

/** The plot area inside a card item at (x, y) of width w. */
export function pdfChartBox(x: number, y: number, w: number): ChartBox {
  return { x: x + CHART_LEFT, y: y + 4, w: w - CHART_LEFT - 6, h: CHART_PLOT_HEIGHT };
}

/** Draws the per-second graph from the shared layout and returns the height it used. */
function drawSeriesChart(d: Doc, chart: SeriesChart, x: number, y: number, w: number): number {
  const box = { x: x + CHART_LEFT, y: y + 4, w: w - CHART_LEFT - 6, h: CHART_PLOT_HEIGHT };
  const layout = layoutSeriesChart(chart, box);
  const bottom = box.y + box.h;
  for (const mark of layout.yMarks) {
    d.moveTo(box.x, mark.y).lineTo(box.x + box.w, mark.y).strokeColor(BORDER).lineWidth(0.5).stroke();
    block(d, mark.label, x, mark.y - 4, CHART_LEFT - 6, { size: 7, colour: MUTED, align: "right", oneLine: true });
  }
  for (const mark of layout.xMarks) {
    d.moveTo(mark.x, box.y).lineTo(mark.x, bottom).strokeColor(BORDER).lineWidth(0.5).stroke();
    block(d, mark.label, mark.x - 15, bottom + 3, 30, { size: 7, colour: MUTED, align: "center", oneLine: true });
  }
  block(d, "Elapsed time (mm:ss) · requests per second", box.x, bottom + 14, box.w, { size: 7, colour: MUTED, align: "center", oneLine: true });
  if (chart.points.length === 1) {
    d.circle(layout.requestsLine[0][0], layout.requestsLine[0][1], 3).fill(ACCENT);
  } else {
    const line = (points: readonly (readonly [number, number])[], colour: string, dashed: boolean) => {
      d.moveTo(points[0][0], points[0][1]);
      for (const [px, py] of points.slice(1)) d.lineTo(px, py);
      if (dashed) d.dash(4, { space: 2.5 });
      d.lineWidth(1.2).strokeColor(colour).stroke();
      if (dashed) d.undash();
    };
    line(layout.requestsLine, ACCENT, false);
    line(layout.failuresLine, FAIL, true);
  }
  for (const [mx, my] of layout.failureMarkers) d.rect(mx - 2, my - 2, 4, 4).fill(FAIL);
  return CHART_PLOT_HEIGHT + 28;
}

function rowsOf<T>(rows: readonly T[], draw: (row: T) => Item): Item[] {
  return rows.map(draw);
}

/**
 * Draws the report with the same design as the HTML report (AP-044): a header with chips, a row of
 * tiles, bordered cards for the run strip, needs attention, failure clusters and slowest requests
 * (side by side), the method breakdown and run details (side by side), and every request. Only the
 * interactive parts (filters, expanding a row, the theme switch) are left to the web page.
 * Deterministic: the document dates come from the run, not the clock, and nothing random is used, so
 * the same run renders to the same bytes. A card that does not fit a page continues on the next with
 * its border closed and reopened, and a long table repeats its header row.
 */
export function renderRunReportPdf(model: RunReportModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const insights = buildRunInsights(model);
    const { summary } = model;
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: MARGIN, bottom: MARGIN + FOOTER_RESERVE, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: {
        Title: toPdfText(`ApiPilot run report - ${model.collectionName}`),
        Author: "ApiPilot",
        Producer: "ApiPilot",
        CreationDate: new Date(model.startedAt),
        ModDate: new Date(model.completedAt ?? model.startedAt),
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // A tall scratch page measures items without ever breaking one across pages.
    const scratch = new PDFDocument({ size: [PAGE_WIDTH, 40000], margin: 0 });
    scratch.on("data", () => undefined);
    const measure = (item: Item, w: number) => item(scratch, 0, 0, w);

    const bottom = () => doc.page.height - MARGIN - FOOTER_RESERVE;
    const newPage = () => {
      doc.addPage();
      doc.y = MARGIN;
    };

    const titleItem =
      (title: string): Item =>
      (d, x, y, w) =>
        block(d, title, x, y, w, { font: "Helvetica-Bold", size: 11, colour: INK }) + 8;

    const note =
      (text: string): Item =>
      (d, x, y, w) =>
        block(d, text, x, y, w, { font: "Helvetica-Oblique", size: 9, colour: MUTED }) + 4;

    const frame = (x: number, y: number, w: number, h: number) => {
      doc.roundedRect(x + 0.4, y + 0.4, w - 0.8, h - 0.8, RADIUS).lineWidth(0.75).strokeColor(BORDER).stroke();
    };

    /** A bordered card that flows across pages; `repeat` is drawn again at the top of a continuation. */
    const card = (title: string, items: Item[], repeat?: Item) => {
      const w = CONTENT_WIDTH;
      const inner = w - PAD * 2;
      const head = titleItem(title);
      const first = items[0] ? measure(items[0], inner) : 0;
      if (doc.y + PAD * 2 + measure(head, inner) + first > bottom()) newPage();
      let top = doc.y;
      let y = top + PAD;
      y += head(doc, MARGIN + PAD, y, inner);
      for (const item of items) {
        const height = measure(item, inner);
        if (y + height + PAD > bottom()) {
          frame(MARGIN, top, w, y + PAD - top);
          newPage();
          top = doc.y;
          y = top + PAD;
          if (repeat) y += repeat(doc, MARGIN + PAD, y, inner);
        }
        item(doc, MARGIN + PAD, y, inner);
        y += height;
      }
      frame(MARGIN, top, w, y + PAD - top);
      doc.y = y + PAD + GAP;
    };

    /** Two cards side by side with equal height; stacked when they would not fit one page together. */
    const pair = (left: { title: string; items: Item[] }, right: { title: string; items: Item[] }) => {
      const w = (CONTENT_WIDTH - GAP) / 2;
      const inner = w - PAD * 2;
      const heightOf = (column: { title: string; items: Item[] }) =>
        PAD * 2 + [titleItem(column.title), ...column.items].reduce((sum, item) => sum + measure(item, inner), 0);
      const height = Math.max(heightOf(left), heightOf(right));
      if (height > bottom() - MARGIN) {
        card(left.title, left.items);
        card(right.title, right.items);
        return;
      }
      if (doc.y + height > bottom()) newPage();
      const top = doc.y;
      [left, right].forEach((column, index) => {
        const x = MARGIN + index * (w + GAP);
        let y = top + PAD;
        for (const item of [titleItem(column.title), ...column.items]) y += item(doc, x + PAD, y, inner);
        frame(x, top, w, height);
      });
      doc.y = top + height + GAP;
    };

    // ---- Header: eyebrow, name, then tier and status chips and the start time
    block(doc, "APIPILOT RUN REPORT", MARGIN, MARGIN, CONTENT_WIDTH, { font: "Courier-Bold", size: 8, colour: ACCENT, oneLine: true });
    const nameHeight = block(doc, toPdfText(model.collectionName), MARGIN, MARGIN + 14, CONTENT_WIDTH, { font: "Helvetica-Bold", size: 22, colour: INK });
    {
      const y = MARGIN + 14 + nameHeight + 6;
      let x = MARGIN;
      const chip = (label: string, border: string) => {
        doc.font("Helvetica-Bold").fontSize(8);
        const width = doc.widthOfString(label) + 16;
        doc.roundedRect(x, y, width, 15, 7.5).fillAndStroke(STRONG, border);
        block(doc, label, x, y + 4, width, { font: "Helvetica-Bold", size: 8, colour: INK, align: "center", oneLine: true });
        x += width + 6;
      };
      chip(toPdfText(model.tier), BORDER);
      chip(model.statusLabel, model.status === "cancelled" ? WARN : PASS);
      block(doc, formatReportTime(model.startedAt), x, y + 3.5, CONTENT_WIDTH, { size: 9, colour: MUTED, oneLine: true });
      doc.y = y + 15 + 18;
    }

    // ---- Tiles: six separate bordered cards
    {
      const gap = 8;
      const width = (CONTENT_WIDTH - gap * 5) / 6;
      const tiles: [string, string, string][] = [
        ["Pass rate", insights.passRate === null ? "-" : `${insights.passRate}%`, insights.passRate === 100 ? PASS : INK],
        ["Requests", String(summary.total), INK],
        ["Passed", String(summary.passed), PASS],
        ["Failed", String(summary.failed), summary.failed > 0 ? FAIL : INK],
        ["Not attempted", String(summary.notAttempted), INK],
        ["Duration", `${summary.durationMs} ms`, INK],
      ];
      const top = doc.y;
      tiles.forEach(([label, value, colour], index) => {
        const x = MARGIN + index * (width + gap);
        frame(x, top, width, 48);
        block(doc, label.toUpperCase(), x + 9, top + 9, width - 12, { font: "Helvetica-Bold", size: 6.5, colour: MUTED, oneLine: true });
        block(doc, value, x + 9, top + 22, width - 12, { font: "Helvetica-Bold", size: 16, colour, oneLine: true });
      });
      doc.y = top + 48 + GAP;
    }

    // ---- Run strip
    card("Run", [
      (d, x, y, w) => {
        const cellWidth = 14;
        const cellHeight = 22;
        const gap = 2;
        const perLine = Math.max(1, Math.floor((w + gap) / (cellWidth + gap)));
        model.rows.forEach((row, index) => {
          let fill = SKIP;
          if (row.outcome === "Passed") fill = PASS;
          else if (row.outcome === "Failed") fill = FAIL;
          d.roundedRect(x + (index % perLine) * (cellWidth + gap), y + Math.floor(index / perLine) * (cellHeight + gap), cellWidth, cellHeight, 3).fill(fill);
        });
        return Math.max(1, Math.ceil(model.rows.length / perLine)) * (cellHeight + gap) + 2;
      },
      (d, x, y, w) =>
        block(d, `One cell per request, in run order: green passed, red failed, grey not attempted. Tests: ${insights.tests.passed} passed, ${insights.tests.failed} failed.`, x, y, w, { size: 8, colour: MUTED }) + 2,
    ]);

    // ---- Requests per second: the same layout the HTML report draws, as vector shapes
    {
      const chart = buildSeriesChart(model.series);
      card(
        "Requests per second",
        chart
          ? [
              (d, x, y, w) => block(d, `Solid line: requests per second (peak ${chart.peak}). Dashed line with square marks: failed requests per second (${chart.failingSteps} of ${chart.points.length} with failures).`, x, y, w, { size: 8, colour: MUTED }) + 4,
              (d, x, y, w) => drawSeriesChart(d, chart, x, y, w),
              (d, x, y, w) => block(d, chart.note, x, y, w, { size: 8, colour: MUTED }) + 2,
            ]
          : [note(NO_REQUESTS_NOTE)],
      );
    }

    // ---- Needs attention
    {
      const columns = { position: 26, request: 216, why: 183, status: 50 };
      const header: Item = (d, x, y, w) => {
        let cx = x;
        for (const [key, label] of [["position", "#"], ["request", "REQUEST"], ["why", "WHY"], ["status", "HTTP"]] as const) {
          block(d, label, cx, y, columns[key] - 4, { font: "Helvetica-Bold", size: 7, colour: MUTED, oneLine: true, align: key === "status" ? "right" : "left" });
          cx += columns[key];
        }
        divider(d, x, y + 13, w);
        return 18;
      };
      const rows: Item[] = rowsOf(insights.failures, (row) => (d, x, y, w) => {
        const nameWidth = columns.request - BADGE_WIDTH - 10;
        const message = row.failedTests[0]?.detail;
        const nameHeight = block(d, toPdfText(row.name), x + columns.position + BADGE_WIDTH + 6, y, nameWidth, { size: 9, colour: INK });
        block(d, String(row.position), x, y, columns.position - 4, { size: 9, colour: MUTED, oneLine: true });
        methodBadge(d, row.method, x + columns.position, y);
        let whyHeight = block(d, toPdfText(row.reason ?? "Failed"), x + columns.position + columns.request, y, columns.why - 8, { size: 9, colour: INK });
        if (message) {
          whyHeight += block(d, toPdfText(message), x + columns.position + columns.request, y + whyHeight, columns.why - 8, { font: "Courier", size: 7.5, colour: MUTED });
        }
        block(d, row.statusCode === undefined ? "-" : String(row.statusCode), x + columns.position + columns.request + columns.why, y, columns.status - 4, { size: 9, colour: INK, align: "right", oneLine: true });
        const height = Math.max(nameHeight, whyHeight, BADGE_HEIGHT) + 8;
        divider(d, x, y + height - 3, w);
        return height;
      });
      card("Needs attention", insights.failures.length === 0 ? [note(summary.total === 0 ? "No requests were recorded." : "No request failed.")] : [header, ...rows], header);
    }

    // ---- Failure clusters | Slowest requests
    const clusterItems: Item[] =
      insights.clusters.length === 0
        ? [note("Nothing to group.")]
        : rowsOf(insights.clusters, (cluster) => (d, x, y, w) => {
            const textX = x + 10;
            const textW = w - 10;
            let height = block(d, toPdfText(`${cluster.reason}${SEP}${cluster.count} request${cluster.count === 1 ? "" : "s"}`), textX, y, textW, { font: "Helvetica-Bold", size: 9, colour: INK });
            if (cluster.message) height += block(d, toPdfText(cluster.message), textX, y + height, textW, { font: "Courier", size: 7.5, colour: INK });
            height += block(d, toPdfText(REASON_EXPLANATION[cluster.reason] ?? ""), textX, y + height, textW, { size: 8, colour: MUTED });
            height += block(d, toPdfText(cluster.requests.map((request) => `${request.position}. ${request.name}`).join(SEP)), textX, y + height, textW, { size: 8, colour: MUTED });
            d.rect(x, y, 2.5, height).fill(FAIL);
            return height + 10;
          });

    const maxMs = Math.max(1, ...insights.slowest.map((row) => row.durationMs));
    const slowestItems: Item[] =
      insights.slowest.length === 0
        ? [note("No request was sent.")]
        : rowsOf(insights.slowest, (row) => (d, x, y, w) => {
            const msWidth = 44;
            const nameWidth = w - BADGE_WIDTH - 6 - msWidth - 4;
            methodBadge(d, row.method, x, y);
            const nameHeight = block(d, toPdfText(row.name), x + BADGE_WIDTH + 6, y, nameWidth, { size: 9, colour: INK });
            block(d, `${row.durationMs} ms`, x + w - msWidth, y, msWidth, { size: 9, colour: INK, align: "right", oneLine: true });
            const barX = x + BADGE_WIDTH + 6;
            const barWidth = nameWidth;
            const barY = y + Math.max(nameHeight, BADGE_HEIGHT) + 3;
            d.roundedRect(barX, barY, barWidth, 6, 3).fill(STRONG);
            d.roundedRect(barX, barY, Math.max(4, (row.durationMs / maxMs) * barWidth), 6, 3).fill(ACCENT);
            const height = barY - y + 6 + 9;
            divider(d, x, y + height - 4, w);
            return height;
          });
    pair({ title: "Failure clusters", items: clusterItems }, { title: "Slowest requests", items: slowestItems });

    // ---- By method | Run details
    const methodColumns = [54, 36, 36, 36, 52];
    const methodItems: Item[] = [
      (d, x, y, w) => {
        let cx = x;
        ["METHOD", "TOTAL", "PASSED", "FAILED", "NOT ATTEMPTED"].forEach((label, index) => {
          block(d, label, cx, y, methodColumns[index] - 3, { font: "Helvetica-Bold", size: 6, colour: MUTED, align: index === 0 ? "left" : "right" });
          cx += methodColumns[index];
        });
        divider(d, x, y + 17, w);
        return 22;
      },
      ...rowsOf(insights.methods, (entry) => (d, x, y, w) => {
        methodBadge(d, entry.method, x, y);
        let cx = x + methodColumns[0];
        [entry.total, entry.passed, entry.failed, entry.notAttempted].forEach((value, index) => {
          block(d, String(value), cx, y + 1.5, methodColumns[index + 1] - 3, { size: 9, colour: INK, align: "right", oneLine: true });
          cx += methodColumns[index + 1];
        });
        divider(d, x, y + BADGE_HEIGHT + 5, w);
        return BADGE_HEIGHT + 9;
      }),
    ];

    const facts: [string, string][] = [
      ["Collection", model.collectionName],
      ["Tier", model.tier],
      ["Status", model.statusLabel],
      ["Started", formatReportTime(model.startedAt)],
      ["Completed", model.completedAt ? formatReportTime(model.completedAt) : "Not completed"],
      ["Duration", `${summary.durationMs} ms`],
      ["Run ID", model.runId],
    ];
    const detailItems: Item[] = rowsOf(facts, ([label, value]) => (d, x, y, w) => {
      const labelWidth = 62;
      block(d, label, x, y, labelWidth - 4, { size: 8.5, colour: MUTED, oneLine: true });
      const valueHeight = block(d, toPdfText(value), x + labelWidth, y, w - labelWidth, {
        font: label === "Run ID" ? "Courier" : "Helvetica",
        size: label === "Run ID" ? 7.5 : 8.5,
        colour: INK,
      });
      const height = Math.max(valueHeight, 11) + 7;
      divider(d, x, y + height - 3, w);
      return height;
    });
    pair({ title: "By method", items: methodItems }, { title: "Run details", items: detailItems });

    // ---- All requests
    {
      const columns = { position: 26, method: 48, name: 207, outcome: 82, status: 50, time: 62 };
      const header: Item = (d, x, y, w) => {
        let cx = x;
        for (const [key, label] of [["position", "#"], ["method", "METHOD"], ["name", "REQUEST"], ["outcome", "OUTCOME"], ["status", "HTTP"], ["time", "TIME"]] as const) {
          block(d, label, cx, y, columns[key] - 4, { font: "Helvetica-Bold", size: 7, colour: MUTED, oneLine: true, align: key === "status" || key === "time" ? "right" : "left" });
          cx += columns[key];
        }
        divider(d, x, y + 13, w);
        return 18;
      };
      const rows: Item[] = rowsOf(model.rows, (row) => (d, x, y, w) => {
        // The line under the name carries what the HTML shows when a row is opened.
        const detail = [
          row.reason,
          row.passedTestCount > 0 ? `${row.passedTestCount} test${row.passedTestCount === 1 ? "" : "s"} passed` : undefined,
          row.edited ? "request was edited before the run" : undefined,
        ]
          .filter(Boolean)
          .join(SEP);
        let nameHeight = block(d, toPdfText(row.name), x + columns.position + columns.method, y, columns.name - 8, { size: 9, colour: INK });
        if (detail) nameHeight += 1 + block(d, toPdfText(detail), x + columns.position + columns.method, y + nameHeight + 1, columns.name - 8, { size: 7.5, colour: MUTED });
        block(d, String(row.position), x, y, columns.position - 4, { size: 9, colour: MUTED, oneLine: true });
        methodBadge(d, row.method, x + columns.position, y);
        block(d, row.outcome, x + columns.position + columns.method + columns.name, y, columns.outcome - 4, { font: "Helvetica-Bold", size: 9, colour: OUTCOME_COLOUR[row.outcome], oneLine: true });
        const statusX = x + columns.position + columns.method + columns.name + columns.outcome;
        block(d, row.statusCode === undefined ? "-" : String(row.statusCode), statusX, y, columns.status - 4, { size: 9, colour: INK, align: "right", oneLine: true });
        block(d, row.outcome === "Not attempted" ? "-" : `${row.durationMs} ms`, statusX + columns.status, y, columns.time - 4, { size: 9, colour: INK, align: "right", oneLine: true });
        const height = Math.max(nameHeight, BADGE_HEIGHT) + 9;
        divider(d, x, y + height - 4, w);
        return height;
      });
      card("All requests", model.rows.length === 0 ? [note("No requests were recorded for this run.")] : [header, ...rows], header);
    }

    // ---- Closing note: the same sentence as the HTML footer
    if (doc.y + 30 > bottom()) newPage();
    block(
      doc,
      "This report lists outcomes only. Request and response headers and bodies, and the collection's variables, are not included. Generated by ApiPilot.",
      MARGIN,
      doc.y - 4,
      CONTENT_WIDTH,
      { size: 8, colour: MUTED },
    );

    // ---- Footer on every page (written with the bottom margin lifted so it never adds a page)
    const range = doc.bufferedPageRange();
    for (let index = 0; index < range.count; index++) {
      doc.switchToPage(range.start + index);
      const footerY = doc.page.height - MARGIN - 8;
      const previousBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      block(doc, `ApiPilot run report - run ${model.runId.slice(0, 8)}`, MARGIN, footerY, CONTENT_WIDTH / 2, { size: 8, colour: MUTED, oneLine: true });
      block(doc, `Page ${index + 1} of ${range.count}`, MARGIN + CONTENT_WIDTH / 2, footerY, CONTENT_WIDTH / 2, { size: 8, colour: MUTED, align: "right", oneLine: true });
      doc.page.margins.bottom = previousBottom;
    }

    scratch.end();
    doc.end();
  });
}
