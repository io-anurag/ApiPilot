/**
 * Styles of the request-chain report (AP-037 research R20, redesign 2026-10-04). Separate from the
 * legacy `STYLE` so reports of earlier runs and their golden files render as before.
 *
 * Theme: the report follows the reader's system setting and offers an Auto / Light / Dark switch that
 * needs no script (the report's Content-Security-Policy forbids it): three radio inputs at the top of
 * the body, read by `:root:has(...)`. Where `:has()` is unsupported the switch does nothing and the
 * system setting still applies.
 */

const LIGHT = [
  "--bg:#f3f6f5", "--surface:#ffffff", "--chrome:#f7faf8", "--fg:#17231f", "--muted:#56675f", "--border:#d8e4df", "--baseline:#b7c6c0", "--hover:rgba(23,35,31,.06)",
  "--brand:#0f8a5f", "--ok-bg:#dcfce7", "--ok-fg:#15803d", "--bad-bg:#fee2e2", "--bad-fg:#b91c1c", "--warn-bg:#fef3c7", "--warn-fg:#92400e", "--neutral-bg:#eef2f0", "--neutral-fg:#334155",
  "--vus:#1baf7a", "--vus-fill:rgba(27,175,122,.16)", "--lat:#2a78d6", "--lat-fill:rgba(42,120,214,.12)", "--rate:#56675f", "--fail:#d03b3b", "--limit:#b45309",
  "--s1:#2a78d6", "--s2:#d97706", "--s3:#0f8a5f", "--s4:#c0439a", "--s5:#7a5af8", "--s6:#0e9fb5", "--s7:#a16207", "--s8:#64748b",
  "--ph1:#94a3b8", "--ph2:#a78bfa", "--ph3:#f59e0b", "--ph4:#2dd4bf", "--ph5:#2a78d6", "--ph6:#1baf7a",
].join(";");

const DARK = [
  "--bg:#0b1411", "--surface:#121d1a", "--chrome:#0c1714", "--fg:#e4efeb", "--muted:#95aaa2", "--border:#263b35", "--baseline:#3a524a", "--hover:rgba(228,239,235,.07)",
  "--brand:#34d399", "--ok-bg:rgba(34,197,94,.16)", "--ok-fg:#bbf7d0", "--bad-bg:rgba(239,68,68,.18)", "--bad-fg:#fecaca", "--warn-bg:rgba(245,158,11,.18)", "--warn-fg:#fde68a", "--neutral-bg:rgba(100,116,139,.2)", "--neutral-fg:#e2e8f0",
  "--vus:#34d399", "--vus-fill:rgba(52,211,153,.18)", "--lat:#5ba2f5", "--lat-fill:rgba(91,162,245,.16)", "--rate:#95aaa2", "--fail:#f06a6a", "--limit:#fbbf24",
  "--s1:#5ba2f5", "--s2:#fbbf24", "--s3:#34d399", "--s4:#f472b6", "--s5:#a78bfa", "--s6:#22d3ee", "--s7:#d9a441", "--s8:#94a3b8",
  "--ph1:#64748b", "--ph2:#a78bfa", "--ph3:#fbbf24", "--ph4:#2dd4bf", "--ph5:#5ba2f5", "--ph6:#34d399",
].join(";");

export const CHAIN_STYLE = `
:root{color-scheme:light;${LIGHT}}
@media (prefers-color-scheme: dark){:root:not(:has(#theme-light:checked)){color-scheme:dark;${DARK}}}
:root:has(#theme-dark:checked){color-scheme:dark;${DARK}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 "IBM Plex Sans","Segoe UI",system-ui,sans-serif}
code,.method,.num,.mono{font-family:"JetBrains Mono","Cascadia Code",Consolas,monospace}
.page{max-width:1280px;margin:0 auto;padding:20px 24px 48px}
.muted{color:var(--muted)}.small{font-size:12px}.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.nowrap{white-space:nowrap}.fail-text{color:var(--bad-fg)}
h1{font-size:22px;line-height:1.25;margin:0}h2{font-size:15px;margin:0 0 12px;letter-spacing:.01em}h3{font-size:13px;margin:0 0 6px}
a{color:var(--lat)}

.theme-input{position:absolute;opacity:0;pointer-events:none}
.theme{display:inline-flex;border:1px solid var(--border);border-radius:8px;background:var(--surface);overflow:hidden}
.theme label{padding:4px 12px;font-size:12px;font-weight:600;color:var(--muted);cursor:pointer;border-right:1px solid var(--border)}.theme label:last-child{border-right:0}
#theme-auto:checked~.top .theme label[for=theme-auto],#theme-light:checked~.top .theme label[for=theme-light],#theme-dark:checked~.top .theme label[for=theme-dark]{background:var(--brand);color:var(--surface)}
.theme-input:focus-visible~.top .theme{outline:2px solid var(--lat);outline-offset:2px}

.top{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px 24px;margin-bottom:16px}
.top .sub{margin:4px 0 0}
.nav{display:flex;flex-wrap:wrap;gap:4px 16px;margin:0 0 16px;font-size:13px}.nav a{text-decoration:none;color:var(--muted);font-weight:600}.nav a:hover,.nav a:focus-visible{color:var(--fg);text-decoration:underline}

.badge{display:inline-block;border-radius:999px;padding:1px 9px;font-size:12px;font-weight:600;white-space:nowrap}
.ok{background:var(--ok-bg);color:var(--ok-fg)}.bad{background:var(--bad-bg);color:var(--bad-fg)}.warn{background:var(--warn-bg);color:var(--warn-fg)}.neutral{background:var(--neutral-bg);color:var(--neutral-fg)}
.method{display:inline-block;min-width:3.6em;text-align:center;border-radius:4px;padding:0 5px;font-size:11px;font-weight:700;background:var(--neutral-bg);color:var(--neutral-fg)}
.m-get{background:var(--ok-bg);color:var(--ok-fg)}.m-post{background:rgba(42,120,214,.16);color:var(--lat)}.m-put,.m-patch{background:var(--warn-bg);color:var(--warn-fg)}.m-delete{background:var(--bad-bg);color:var(--bad-fg)}

.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;margin:0 0 16px;min-width:0}
.card>h2{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.card>h2 .small{font-weight:400}
.verdict{display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px;border-left-width:5px;padding:12px 16px}
.verdict.v-ok{border-left-color:var(--ok-fg)}.verdict.v-bad{border-left-color:var(--fail)}.verdict.v-neutral{border-left-color:var(--baseline)}
.verdict strong{font-size:15px}

.facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px 24px;margin:0}
.facts dt{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.facts dd{margin:2px 0 0;overflow-wrap:anywhere}

.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin:0 0 16px}
.tile{border:1px solid var(--border);border-radius:10px;background:var(--surface);padding:12px 14px;min-width:0}
.tile .k{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.tile .v{font:600 22px/1.3 "JetBrains Mono",Consolas,monospace}.tile.t-bad{border-color:var(--fail)}.tile.t-bad .v{color:var(--bad-fg)}.tile.t-ok .v{color:var(--ok-fg)}

.cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}.cols>.card{margin:0}.cols+*{margin-top:16px}
.charts-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.charts-pair>.card{margin:0}.charts-pair+.card,.card+.charts-pair{margin-top:16px}

table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);background:var(--chrome);padding:7px 10px;border-bottom:1px solid var(--border);white-space:nowrap}th.num{text-align:right}
td{padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}tbody tr:last-child td{border-bottom:0}tbody tr:hover td{background:var(--hover)}
tr.failing td:first-child{box-shadow:inset 3px 0 0 var(--fail)}
.scroll{overflow-x:auto}
.req-table{min-width:1080px}.req-table td.step{min-width:260px}.req-table td.step code{white-space:nowrap}.req-table .chain-row td{background:var(--chrome);font-weight:700;font-size:12px;border-bottom:1px solid var(--border)}
.bar{display:block;height:4px;border-radius:2px;background:var(--lat);margin-top:3px;min-width:1px}.bar.b-bad{background:var(--fail)}
.st{display:inline-block;margin:0 4px 3px 0;white-space:nowrap}
.legend{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12px;margin:0 0 8px}.legend span{display:inline-flex;align-items:center;gap:6px}
.sw{display:inline-block;width:18px;height:0;border-top:3px solid var(--lat)}.sw.dash{border-top-style:dashed}.sw.dot{border-top-style:dotted}

svg{width:100%;height:auto;display:block}
.grid{stroke:var(--border);stroke-width:1}.baseline{stroke:var(--baseline);stroke-width:1}.axis{fill:var(--muted);font:11px "JetBrains Mono",Consolas,monospace}
.line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}.l-vus{stroke:var(--vus)}.l-lat{stroke:var(--lat)}.l-rate{stroke:var(--rate)}.l-fail{stroke:var(--fail)}
.area-vus{fill:var(--vus-fill)}.area-lat{fill:var(--lat-fill)}
.dot-lat{fill:var(--lat);stroke:var(--surface);stroke-width:2}.dot-fail{fill:var(--fail);stroke:var(--surface);stroke-width:2}
.limit{stroke:var(--limit);stroke-width:1.5;stroke-dasharray:6 4}.limit-text{fill:var(--limit);font:600 11px "JetBrains Mono",Consolas,monospace}
.s1{stroke:var(--s1)}.s2{stroke:var(--s2)}.s3{stroke:var(--s3)}.s4{stroke:var(--s4)}.s5{stroke:var(--s5)}.s6{stroke:var(--s6)}.s7{stroke:var(--s7)}.s8{stroke:var(--s8)}
.d1{stroke-dasharray:none}.d2{stroke-dasharray:7 3}.d3{stroke-dasharray:2 3}
.sw.s1{border-top-color:var(--s1)}.sw.s2{border-top-color:var(--s2)}.sw.s3{border-top-color:var(--s3)}.sw.s4{border-top-color:var(--s4)}.sw.s5{border-top-color:var(--s5)}.sw.s6{border-top-color:var(--s6)}.sw.s7{border-top-color:var(--s7)}.sw.s8{border-top-color:var(--s8)}
.sw.l-vus{border-top-color:var(--vus)}.sw.l-lat{border-top-color:var(--lat)}.sw.l-rate{border-top-color:var(--rate)}.sw.l-fail{border-top-color:var(--fail)}.sw.limit{border-top-color:var(--limit)}
.hit{fill:transparent}.hit:hover{fill:var(--hover)}
details.data{margin-top:8px;border:0;padding:0}

ol.findings{padding-left:20px;margin:0}ol.findings li{margin:6px 0}
p.note{margin:8px 0 0}

details.step{border:1px solid var(--border);border-radius:8px;margin:0 0 8px;background:var(--surface);padding:0}
details.step>summary{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;padding:8px 12px;cursor:pointer;list-style-position:inside}
details.step[open]>summary{border-bottom:1px solid var(--border)}
details.step .glance{margin-left:auto;font-size:12px;color:var(--muted)}details.step .glance.fail-text{color:var(--bad-fg)}
details.step dl{display:grid;grid-template-columns:150px minmax(0,1fr);gap:6px 14px;margin:0;padding:12px}
details.step dt{color:var(--muted);font-size:12px;font-weight:600}details.step dd{margin:0;min-width:0;overflow-wrap:anywhere}details.step ul{margin:0;padding-left:18px}
.chain-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;margin:16px 0 8px}.chain-head:first-of-type{margin-top:0}
.phase-bar{display:flex;height:10px;border-radius:5px;overflow:hidden;margin:2px 0 6px;background:var(--neutral-bg)}.phase-bar i{display:block;height:100%}
.p1{background:var(--ph1)}.p2{background:var(--ph2)}.p3{background:var(--ph3)}.p4{background:var(--ph4)}.p5{background:var(--ph5)}.p6{background:var(--ph6)}
table.phases{font-size:12px}table.phases th,table.phases td{padding:3px 8px}table.phases .pk{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}

@media (max-width:960px){.facts{grid-template-columns:repeat(2,minmax(0,1fr))}.cols,.charts-pair{grid-template-columns:minmax(0,1fr)}}
@media (max-width:560px){.page{padding:14px 12px 32px}.facts{grid-template-columns:minmax(0,1fr)}details.step dl{grid-template-columns:minmax(0,1fr)}details.step .glance{margin-left:0}}
@media print{.theme,.nav{display:none}}
`;
