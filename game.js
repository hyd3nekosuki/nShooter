"use strict";

// ---- canvas setup ----
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// fixed logical game resolution (4:3) - all layout constants and drawing
// code below are written in this coordinate space, regardless of how many
// actual device pixels the canvas's backing buffer ends up with
const GAME_W = 640, GAME_H = 480;

// current CSS-px-per-logical-px scale (set by resizeCanvas()) - kept around
// so per-frame DOM sync code (e.g. the game-over score's dynamic font size)
// can reposition text without waiting for the next resize event
let currentUIScale = 1;

// side panel HUD layout: a stack of rounded cards (declared here, before
// resizeCanvas(), since resizeCanvas() runs immediately below and positions
// the DOM text overlay against these same logical coordinates)
const PANEL_X = 392, PANEL_W = 232;
const CARD_PLAYER = { x: PANEL_X, y: 8, w: PANEL_W, h: 22 };
const CARD_SCORE_TIME = { x: PANEL_X, y: 38, w: PANEL_W, h: 56 };
const CARD_POWER = { x: PANEL_X, y: 102, w: PANEL_W, h: 44 };
const CARD_CHAIN = { x: PANEL_X, y: 154, w: PANEL_W, h: 44 };

// HUD text is rendered as real DOM elements overlaid on the canvas instead of
// via ctx.fillText() - browser text rendering (subpixel hinting/antialiasing)
// is crisper than canvas-rasterized text, especially once scaled up to fill
// the window. These are positioned/sized to match the logical HUD card
// coordinates above, scaled by the same factor resizeCanvas() uses for the
// canvas itself; only content (score/time/etc.) is updated per frame.
const hudOverlayEl = document.getElementById("hudOverlay");
const hudPlayerNameEl = document.getElementById("hudPlayerName");
const hudScoreLabelEl = document.getElementById("hudScoreLabel");
const hudScoreValueEl = document.getElementById("hudScoreValue");
const hudTimeLabelEl = document.getElementById("hudTimeLabel");
const hudTimeValueEl = document.getElementById("hudTimeValue");
const hudPowerLabelEl = document.getElementById("hudPowerLabel");
const hudChainLabelEl = document.getElementById("hudChainLabel");
const hudChainValueEl = document.getElementById("hudChainValue");

function positionHudText(el, x, y, fontSizePx, scale) {
  el.style.left = x * scale + "px";
  el.style.top = y * scale + "px";
  el.style.fontSize = fontSizePx * scale + "px";
}

// the title/game-over screens' text was drawn with the canvas default
// "alphabetic" baseline (unlike the HUD above, which used "top") - approximate
// baseline -> top-left conversion so positionHudText() can still be reused
const BASELINE_TO_TOP_RATIO = 0.78; // approx ascent fraction for this bold sans-serif stack
function positionHudTextBaseline(el, x, y, fontSizePx, scale) {
  positionHudText(el, x, y - fontSizePx * BASELINE_TO_TOP_RATIO, fontSizePx, scale);
}

function positionHudOverlay(scale) {
  positionHudText(hudPlayerNameEl, CARD_PLAYER.x + CARD_PLAYER.w / 2, CARD_PLAYER.y + 6, 13, scale);
  positionHudText(hudScoreLabelEl, CARD_SCORE_TIME.x + CARD_SCORE_TIME.w * 0.27, CARD_SCORE_TIME.y + 6, 12, scale);
  positionHudText(hudScoreValueEl, CARD_SCORE_TIME.x + CARD_SCORE_TIME.w * 0.27, CARD_SCORE_TIME.y + 22, 22, scale);
  positionHudText(hudTimeLabelEl, CARD_SCORE_TIME.x + CARD_SCORE_TIME.w * 0.73, CARD_SCORE_TIME.y + 6, 12, scale);
  positionHudText(hudTimeValueEl, CARD_SCORE_TIME.x + CARD_SCORE_TIME.w * 0.73, CARD_SCORE_TIME.y + 22, 22, scale);
  positionHudText(hudPowerLabelEl, CARD_POWER.x + 12, CARD_POWER.y + 6, 12, scale);
  positionHudText(hudChainLabelEl, CARD_CHAIN.x + 12, CARD_CHAIN.y + 6, 12, scale);
  positionHudText(hudChainValueEl, CARD_CHAIN.x + CARD_CHAIN.w * 0.5, CARD_CHAIN.y + 20, 18, scale);
}

// scale the canvas to fit the browser window (CSS size), while sizing its
// backing pixel buffer to GAME_W/H * devicePixelRatio so it renders at native
// sharpness on high-DPI displays instead of being upscaled/blurred by the
// browser. ctx.setTransform (not ctx.scale) keeps this idempotent across
// repeated resize events - drawing code still just uses GAME_W x GAME_H.
const LOG_BASE_FONT = 13, LOG_BASE_PAD_V = 6, LOG_BASE_PAD_H = 16, LOG_BASE_RADIUS = 12, LOG_BASE_MIN_H = 20;
function resizeCanvas() {
  const logBar = document.getElementById("learningLog");
  const availW = window.innerWidth - 16;
  const availH = window.innerHeight - logBar.offsetHeight - 32;
  const scale = Math.max(0.25, Math.min(availW / GAME_W, availH / GAME_H));
  canvas.style.width = Math.floor(GAME_W * scale) + "px";
  canvas.style.height = Math.floor(GAME_H * scale) + "px";

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(GAME_W * dpr);
  canvas.height = Math.round(GAME_H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  currentUIScale = scale;
  positionHudOverlay(scale);
  positionTitleOverlay(scale);
  positionGameOverOverlay(scale);

  // the control/learning-log bar scales in step with the canvas (clamped
  // more tightly than the canvas itself so its text stays legible at both
  // very small and very large window sizes)
  const logScale = Math.max(0.65, Math.min(1.6, scale));
  logBar.style.fontSize = (LOG_BASE_FONT * logScale).toFixed(1) + "px";
  logBar.style.padding = (LOG_BASE_PAD_V * logScale).toFixed(1) + "px " + (LOG_BASE_PAD_H * logScale).toFixed(1) + "px";
  logBar.style.borderRadius = (LOG_BASE_RADIUS * logScale).toFixed(1) + "px";
  logBar.style.minHeight = (LOG_BASE_MIN_H * logScale).toFixed(1) + "px";
}
window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", resizeCanvas);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resizeCanvas);
// the initial call happens at the bottom of this file (see "---- boot ----"),
// after TITLE_CONFIG_PARAMS/MAX_RECORDS and the DOM elements they generate exist

// ---- playfield geometry ----
const FIELD_X = 16, FIELD_Y = 16, FIELD_W = 368, FIELD_H = 448;
const FIELD_RIGHT = FIELD_X + FIELD_W;
const FIELD_BOTTOM = FIELD_Y + FIELD_H;

// ---- "reiwa kids" pop visual theme (procedural, no image assets) ----
const COLORS = {
  skyTop: "#8fd8ff", skyBottom: "#eaf9ff",
  playfieldBg: "#0a2f57", // deep navy "underwater" water, not outer space
  cardBg: "rgba(255,255,255,0.92)",
  cardShadow: "rgba(80,60,150,0.28)",
  textDark: "#3a2f6b",
  accent: "#ff6b81",
  u235: "#ff6b81", u238: "#43d17a", pu: "#8b6bff", b10: "#aab3cf",
};
const TYPE_COLORS = [COLORS.u235, COLORS.u238, COLORS.pu, COLORS.b10];
const FONT = "'HGP創英丸ゴシック UB', 'Rounded Mplus 1c', 'Kosugi Maru', 'Meiryo', sans-serif";

function roundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// rounded only at the top two corners, flat straight edge across the bottom
// - used for the title-config meter fill (see drawTitleConfigPanel()), whose
// bottom edge is meant to be clipped to its track's own rounding instead of
// rounding itself (see that call site for why: a fill short enough to need
// a small top radius can't ALSO carry the track's full 6px radius at the
// bottom without the two competing curves fighting each other)
function topRoundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

function drawCard(x, y, w, h) {
  roundRectPath(x, y, w, h, 14);
  ctx.save();
  ctx.shadowColor = COLORS.cardShadow;
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = COLORS.cardBg;
  ctx.fill();
  ctx.restore();
}

function lighten(hex, amt) {
  const c = parseInt(hex.slice(1), 16);
  let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  r = Math.min(255, Math.round(r + (255 - r) * amt));
  g = Math.min(255, Math.round(g + (255 - g) * amt));
  b = Math.min(255, Math.round(b + (255 - b) * amt));
  return `rgb(${r},${g},${b})`;
}

function rgbaFromHex(hex, alpha) {
  const c = parseInt(hex.slice(1), 16);
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// simple "overshoot" ease so spawning targets pop in with a little bounce
function easeOutBack(x) {
  const c1 = 1.70158, c3 = c1 + 1;
  x = Math.min(1, Math.max(0, x));
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}


// prompt neutron multiplicity distributions (Zucker & Holden, Nucl. Sci. Eng.
// 1984, doi:10.13182/NSE84-A18506)
const NEUTRON_YIELD_DIST_U235 = [
  0.0291, // P(0)
  0.1660, // P(1)
  0.3362, // P(2)
  0.3074, // P(3)
  0.1333, // P(4)
  0.0259, // P(5)
  0.0021, // P(6)
  0.0002, // P(7)
]; // mean 2.437

const NEUTRON_YIELD_DIST_PU239 = [
  0.0104, // P(0)
  0.0954, // P(1)
  0.2728, // P(2)
  0.3306, // P(3)
  0.2133, // P(4)
  0.0644, // P(5)
  0.0119, // P(6)
  0.0013, // P(7)
]; // mean 2.889

// ---- independent fission product yields (U-235 and Pu-239) ----
// sources: data/fission_products_u235_thermal.js and data/fission_products_pu239_thermal.js
// (JENDL-5 independent yields, thermal fission, sum to 2.0 per fission event =
// one per fragment), loaded as plain globals (<script> tags) rather than
// fetched as JSON, since fetch() of local files is blocked when the game is
// opened directly via file:// (double-click) instead of through a web server
const fissionProducts = window.FISSION_PRODUCTS_U235;

// builds a lookup table for one fissile nuclide's product data, keyed so the
// complementary fragment of a given (A, Z) split is a single Map lookup away
function buildFissionTable(products, compoundA, compoundZ, neutronDist) {
  return {
    products,
    totalYield: products.reduce((sum, p) => sum + p.yield, 0),
    byAZ: new Map(products.map((p) => [`${p.A},${p.Z}`, p])),
    compoundA, // A of the fissile nuclide + 1 captured neutron
    compoundZ, // Z of the fissile nuclide (protons are conserved regardless of neutronCount)
    neutronDist,
  };
}

// U235 + n -> compound nucleus Z=92, A=236 -> fragments + k neutrons
const FISSION_TABLE_U235 = buildFissionTable(window.FISSION_PRODUCTS_U235, 236, 92, NEUTRON_YIELD_DIST_U235);
// Pu239 + n -> compound nucleus Z=94, A=240 -> fragments + k neutrons
const FISSION_TABLE_PU239 = buildFissionTable(window.FISSION_PRODUCTS_PU239, 240, 94, NEUTRON_YIELD_DIST_PU239);
// same two compound-nucleus reactions, but sampled from JENDL-5's 500keV/14MeV
// incident-neutron yield tables instead of thermal (0.0253eV) - same nuclide
// list (same byAZ keys), only the yield numbers differ per energy. Neutron
// multiplicity (neutronDist) isn't varied by energy here - only requested for
// product yields, not neutron count, so all three tables per isotope share
// the same NEUTRON_YIELD_DIST_* (see fissionTableFor()'s own comment for how
// one of the three gets picked per event)
const FISSION_TABLE_U235_500KEV = buildFissionTable(window.FISSION_PRODUCTS_U235_500KEV, 236, 92, NEUTRON_YIELD_DIST_U235);
const FISSION_TABLE_U235_14MEV = buildFissionTable(window.FISSION_PRODUCTS_U235_14MEV, 236, 92, NEUTRON_YIELD_DIST_U235);
const FISSION_TABLE_PU239_500KEV = buildFissionTable(window.FISSION_PRODUCTS_PU239_500KEV, 240, 94, NEUTRON_YIELD_DIST_PU239);
const FISSION_TABLE_PU239_14MEV = buildFissionTable(window.FISSION_PRODUCTS_PU239_14MEV, 240, 94, NEUTRON_YIELD_DIST_PU239);
// ordered thermal -> 500keV -> 14MeV, matching FISSION_YIELD_SPEED_ANCHORS
// (defined later, near NEUTRON_FAST_REFERENCE_SPEED - see fissionTableFor())
const FISSION_TABLES_U235 = [FISSION_TABLE_U235, FISSION_TABLE_U235_500KEV, FISSION_TABLE_U235_14MEV];
const FISSION_TABLES_PU239 = [FISSION_TABLE_PU239, FISSION_TABLE_PU239_500KEV, FISSION_TABLE_PU239_14MEV];

const fissionAMin = Math.min(...fissionProducts.map((p) => p.A));
const fissionAMax = Math.max(...fissionProducts.map((p) => p.A));
let fissionABins = new Array(fissionAMax - fissionAMin + 1).fill(0);
let fissionABinMax = 1; // largest bin count so far, for auto-scaling the chart
let floatingLabels = []; // isotope name pop-ups shown when a fission product bin is incremented

// layout of the fission yield chart card (bottom of the side panel)
const FISSION_CHART = {
  panelX: PANEL_X, panelRight: PANEL_X + PANEL_W, panelTop: 206, panelBottom: 464,
  chartTop: 218, baseY: 452,
};

function fissionChartBinWidth() {
  return (FISSION_CHART.panelRight - FISSION_CHART.panelX - 20) / fissionABins.length;
}

function fissionChartBarX(A) {
  const barW = fissionChartBinWidth();
  return FISSION_CHART.panelX + 10 + (A - fissionAMin + 0.5) * barW;
}

// minimum time between two floating labels appearing anywhere on the chart -
// near the peaks, adjacent mass numbers are only ~2px apart (much narrower than
// a label's text), so without this throttle their labels pile up unreadably
const FLOATING_LABEL_MIN_GAP = 0.22;
let floatingLabelCooldown = 0;

// bin counting always happens; `shouldLabel` is decided once per fission event
// (not per product) so the cross-event cooldown can't split a pair in half
function recordFissionProductBin(A, symbol, shouldLabel) {
  const idx = A - fissionAMin;
  if (idx < 0 || idx >= fissionABins.length) return;
  fissionABins[idx]++;
  if (fissionABins[idx] > fissionABinMax) fissionABinMax = fissionABins[idx];
  if (!shouldLabel) return;

  const chartH = FISSION_CHART.baseY - FISSION_CHART.chartTop;
  const barH = (fissionABins[idx] / fissionABinMax) * chartH;
  const jitterX = (Math.random() - 0.5) * 14;
  const jitterY = (Math.random() - 0.5) * 10;
  const verticalOffset = 18; // nudge the label down from the bar top, toward the bar itself
  floatingLabels.push({
    x: fissionChartBarX(A) + jitterX,
    y: FISSION_CHART.baseY - barH + jitterY + verticalOffset,
    A, symbol,
    t: 0, dur: 1.3,
  });
}

function weightedPickFissionProduct(candidates, totalWeight) {
  let r = Math.random() * totalWeight;
  for (const p of candidates) {
    r -= p.yield;
    if (r <= 0) return p;
  }
  return candidates[candidates.length - 1];
}

// picks the two fission product nuclides for an (n,f) event on the given
// fissile table (U235 or Pu239), given the number of prompt neutrons it
// released, conserving both mass number and proton number:
//   A(fissile) + 1 (captured neutron) = A(product1) + A(product2) + neutronCount
//   Z(fissile) = Z(product1) + Z(product2)  (neutrons carry no charge, so this
//   holds regardless of neutronCount - protons are never created or destroyed here)
function pickFissionProducts(table, neutronCount) {
  const targetSumA = table.compoundA - neutronCount;
  const targetSumZ = table.compoundZ;
  for (let attempt = 0; attempt < 25; attempt++) {
    const p1 = weightedPickFissionProduct(table.products, table.totalYield);
    const p2 = table.byAZ.get(`${targetSumA - p1.A},${targetSumZ - p1.Z}`);
    if (p2) return [p1, p2];
  }
  // no mass+charge-conserving pair found after several tries (the exact
  // complementary nuclide isn't in the yield table) - fall back to picking
  // both fragments independently
  return [
    weightedPickFissionProduct(table.products, table.totalYield),
    weightedPickFissionProduct(table.products, table.totalYield),
  ];
}

// ---- target types ----
const TYPE_U235 = 0, TYPE_U238 = 1, TYPE_PU = 2, TYPE_B10 = 3;
const TARGET_RADIUS = 15;

// ---- configurable simulation parameters ----
// adjustable from the title screen (hold Shift + ←/→ to pick one, Shift + ↑/↓
// to change its value) - kept in one object so the title-screen meter panel
// can read/write them generically by key
const simConfig = {
  // ①ウラン濃縮度: ウラン(235U+238U)のうち235Uが占める割合 (0.0-1.0)。上げるほど235Uが増え、238Uが減る。
  uraniumEnrichment: 0.6,
  // ②燃料量: 画面上のウラン(核種)量の相対値を百分率の整数で表す(100が標準量)。
  // 大きいほど原子核の出現ペース・最大数が増える(実際の出現ペース計算では 100 で割って
  // FUEL_AMOUNT_BASE 倍して使う)。タイトル画面のスライダーで小数点が出ないよう、
  // 内部値そのものを常に整数(10刻み)にしている。
  fuelAmount: 100,
  // ③10B濃度: 中性子吸収材10Bの出現割合 (0.0-1.0)。0で10Bは一切出現しない。
  b10Concentration: 0,
  // 気泡率: 画面(水中)に占める「気泡(ボイド)」帯の割合の目安 (0.0-1.0)。
  // ボイド内では水による中性子減速が働かず、核反応(核分裂・中性子捕獲)が起こりにくくなる。
  voidRate: 0.15,
  // 運転時間: 1プレイあたりの制限時間(秒)。
  operationTime: 60,
  // Pu富化度(隠しパラメータ - タイトル画面のUIには出さない): 落下する①燃料のうち、
  // 最初からPuとして生成される割合 (0.0-1.0)。初期値0では①燃料はU235/U238のみで、
  // ウラン濃縮度に応じて確率的に選ばれる。console等から simConfig.puEnrichment を
  // 直接書き換えることでのみ変更できる。
  puEnrichment: 0,
};

// displayScale converts between the number typed on the keyboard (see the
// Shift+digits direct-entry feature below) and the internally-stored value -
// 100 for the params shown as a percentage, 1 for the ones already stored in
// the same units they're displayed in (feels natural: whatever's on screen
// is exactly what you type)
const TITLE_CONFIG_PARAMS = [
  { key: "uraniumEnrichment", massPrefix: 235, symbolPrefix: "U", labelSuffix: "濃縮度", min: 0, max: 1.0, step: 0.02, displayScale: 100, format: (v) => Math.round(v * 100) + "%" },
  { key: "fuelAmount", label: "燃料量", min: 10, max: 200, step: 10, displayScale: 1, format: (v) => String(v) },
  { key: "b10Concentration", massPrefix: 10, symbolPrefix: "B", labelSuffix: "濃度", min: 0, max: 1.0, step: 0.05, displayScale: 100, format: (v) => String(Math.round(v * 100)) },
  { key: "voidRate", label: "気泡率", min: 0, max: 0.8, step: 0.02, displayScale: 100, format: (v) => Math.round(v * 100) + "%" },
  { key: "operationTime", label: "運転時間", min: 20, max: 180, step: 10, displayScale: 1, format: (v) => v.toFixed(0) + "s" },
];
let titleConfigIndex = 0;

function selectTitleConfig(dir) {
  titleConfigIndex = (titleConfigIndex + dir + TITLE_CONFIG_PARAMS.length) % TITLE_CONFIG_PARAMS.length;
}

function adjustTitleConfig(dir) {
  const p = TITLE_CONFIG_PARAMS[titleConfigIndex];
  const newVal = Math.min(p.max, Math.max(p.min, simConfig[p.key] + dir * p.step));
  simConfig[p.key] = Math.round(newVal * 1000) / 1000;
}

// direct numeric entry: hold Shift, type digits (top row or numpad), release
// Shift to apply the typed integer to the currently-selected param - out-of-
// range values clamp to the nearest bound; no digits typed leaves it unchanged
let titleDigitBuffer = "";
function digitFromKeyCode(code) {
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  return null;
}
function applyTitleDigitInput() {
  if (titleDigitBuffer !== "") {
    const n = Number(titleDigitBuffer);
    if (Number.isFinite(n)) {
      const p = TITLE_CONFIG_PARAMS[titleConfigIndex];
      const raw = n / (p.displayScale || 1);
      const clamped = Math.min(p.max, Math.max(p.min, raw));
      simConfig[p.key] = Math.round(clamped * 1000) / 1000;
    }
  }
  titleDigitBuffer = "";
}

// simConfig.fuelAmount is normalized so that 100 (%) = "standard" fuel
// amount; the original (pre-normalization) spawn-pacing formulas were tuned
// around a raw weight of 2.4, so divide by 100 and multiply back up by this
// base before using them
const FUEL_AMOUNT_BASE = 2.4;

// B10 (③10B濃度) spawns through its own independent pacing/cap, scaled
// linearly by b10Concentration - at concentration 1.0 this is how fast
// / how many B10 can be on screen at once; at 0, no B10 spawns at all
const B10_SPAWN_INTERVAL_AT_MAX = 0.35;
const B10_MAX_TARGETS_AT_MAX = 22;

let voidBands = []; // circular bubbles: { x, y, r }
let voidSpawnTimer = 0;
const VOID_SPEED = 45; // px/s downward drift of void bubbles, independent of target fall speed

// neutron moderation: speed decays exponentially with distance traveled through
// water, toward a thermalized minimum floor (never fully stops). Voids don't
// moderate at all, so a neutron passing through one stays fast.
const NEUTRON_MIN_SPEED = 40; // px/s floor
const NEUTRON_DECAY_LENGTH = 190; // px of travel through water for speed to fall by ~63% of the way to the floor

// reaction probability now depends on the neutron's own current speed rather
// than location: at (near) its initial speed a neutron is "fast" and unlikely
// to react; as it slows toward the thermalized floor, reactions become certain
const FAST_REACTION_CHANCE_FISSION = 0.10; // 235U/Pu fission, 10B capture, at initial speed
const FAST_REACTION_CHANCE_CAPTURE238 = 0.50; // 238U capture, at initial speed

const NEUTRON_FAST_REFERENCE_SPEED = 480; // "still fast" reference speed - a normal (uncharged) shot

// interpolates fastChance (at/above NEUTRON_FAST_REFERENCE_SPEED) up to 1.0 (at
// the thermalized floor speed), based on the neutron's CURRENT ABSOLUTE speed -
// not relative to its own launch speed. Using an absolute reference (rather
// than each bullet's own speed0) means a charge-shot neutron that launches
// already slow is correctly treated as "slow" from the moment it's fired,
// instead of reading as "still fresh" relative to its own reduced speed0.
function reactionProbability(currentSpeed, fastChance) {
  const range = NEUTRON_FAST_REFERENCE_SPEED - NEUTRON_MIN_SPEED;
  const slowness = Math.min(1, Math.max(0, (NEUTRON_FAST_REFERENCE_SPEED - currentSpeed) / range));
  return fastChance + (1 - fastChance) * slowness;
}

// which of the 3 energy-specific fission-yield tables (see FISSION_TABLES_U235/
// PU239) an (n,f) event draws from, based on the reacting neutron's own
// current speed - reuses these exact same 3 reference speeds (thermalized
// floor / "still fast" reference) reactionProbability() already anchors its
// own curve to, so both curves move in step off the one shared moderation
// model instead of needing a second, independently-tuned decay length.
// NEUTRON_MIN_SPEED (thermal) / 150 (~500keV - roughly a delayed neutron's
// own spawn speed) / NEUTRON_FAST_REFERENCE_SPEED (14MeV, an uncharged shot)
const FISSION_YIELD_SPEED_ANCHORS = [NEUTRON_MIN_SPEED, 150, NEUTRON_FAST_REFERENCE_SPEED];

// picks ONE of `tables` (ordered to match FISSION_YIELD_SPEED_ANCHORS) rather
// than blending their yields together - simpler, and statistically converges
// to the same result over many fission events. Interpolates in log(speed)
// space between whichever pair of anchors brackets `speed` (clamped at the
// ends), and rolls that fraction as a straight probability of landing on the
// upper vs lower table of the pair.
function pickFissionYieldTable(tables, speed) {
  const anchors = FISSION_YIELD_SPEED_ANCHORS;
  if (speed <= anchors[0]) return tables[0];
  if (speed >= anchors[anchors.length - 1]) return tables[tables.length - 1];
  for (let i = 0; i < anchors.length - 1; i++) {
    if (speed <= anchors[i + 1]) {
      const t = (Math.log(speed) - Math.log(anchors[i])) / (Math.log(anchors[i + 1]) - Math.log(anchors[i]));
      return Math.random() < t ? tables[i + 1] : tables[i];
    }
  }
  return tables[tables.length - 1];
}

function fissionTableFor(targetType, speed) {
  const tables = targetType === TYPE_PU ? FISSION_TABLES_PU239 : FISSION_TABLES_U235;
  return pickFissionYieldTable(tables, speed);
}

// a neutron that doesn't react on contact scatters instead: it keeps its
// current speed but bounces off in a new random direction
function scatterBullet(b) {
  const speed = Math.hypot(b.vx, b.vy);
  const angle = Math.random() * Math.PI * 2;
  b.vx = Math.cos(angle) * speed;
  b.vy = Math.sin(angle) * speed;
}

// the ship also acts as a Breakout-style paddle: a neutron falling onto it
// deflects back upward, with the angle steered by where along the ship it
// landed (center = straight up, edges = up to this many radians off-center)
const PADDLE_BOUNCE_MAX_ANGLE = Math.PI / 3; // 60 degrees either side of straight up

function paddleBounceBullet(b, player) {
  const speed = Math.hypot(b.vx, b.vy);
  const offset = Math.max(-1, Math.min(1, (b.x - player.x) / (player.w / 2)));
  const angle = -Math.PI / 2 + offset * PADDLE_BOUNCE_MAX_ANGLE;
  b.vx = Math.cos(angle) * speed;
  b.vy = Math.sin(angle) * speed;
  b.y = player.y - player.h / 2 - 6; // nudge clear of the ship so it doesn't re-trigger next frame
}

// periodic (torus) boundary in X only, for a bubble whose center lands close
// enough to a side wall that its circle would otherwise overflow past it
// (see updateVoidBands() - bubble centers now spawn across the full field
// width): returns where the overflowing sliver reappears on the OPPOSITE
// wall, or null if this bubble doesn't overflow either wall at all. Never
// overflows both walls at once here (2*max radius is well under FIELD_W).
// Y is left alone - bubbles entering/exiting top and bottom is already the
// intended "rising through water" look, not something to wrap.
function voidWrapX(bubble) {
  if (bubble.x - bubble.r < FIELD_X) return bubble.x + FIELD_W;
  if (bubble.x + bubble.r > FIELD_RIGHT) return bubble.x - FIELD_W;
  return null;
}

function bubbleContaining(x, y) {
  for (const bubble of voidBands) {
    const dx = x - bubble.x, dy = y - bubble.y;
    if (dx * dx + dy * dy <= bubble.r * bubble.r) return bubble;
    const wrapX = voidWrapX(bubble);
    if (wrapX !== null) {
      const dxw = x - wrapX;
      if (dxw * dxw + dy * dy <= bubble.r * bubble.r) return bubble;
    }
  }
  return null;
}

function isInVoid(x, y) {
  return !!bubbleContaining(x, y);
}

function updateVoidBands(dt) {
  for (const bubble of voidBands) bubble.y += VOID_SPEED * dt;
  voidBands = voidBands.filter((bubble) => bubble.y - bubble.r < FIELD_BOTTOM + 10);
  if (simConfig.voidRate <= 0) return;
  voidSpawnTimer -= dt;
  if (voidSpawnTimer <= 0) {
    const r = 35 + Math.random() * 35;
    // spans the full field width rather than keeping the whole circle
    // contained (FIELD_X + r .. FIELD_RIGHT - r) - at higher void rates that
    // inset noticeably shrinks the usable spawn range for the largest
    // bubbles, so let a bubble's center land anywhere across the field and
    // straddle the left/right wall if it lands near one. The overhang isn't
    // lost, either: it reappears wrapped on the opposite wall (see
    // voidWrapX(), used by bubbleContaining()/drawVoidBands()) - a periodic
    // boundary in X, so every bubble keeps its full circle's worth of area
    // "in the field" somewhere, which is exactly what the area*lifetime math
    // below already assumes
    const x = FIELD_X + Math.random() * FIELD_W;
    voidBands.push({ x, y: FIELD_Y - r, r });
    // next spawn timed so this bubble's own "area x lifetime" contribution
    // (its share of the field's area-time budget) works out to exactly
    // voidRate on average. area*lifetime, not just area, matters here because
    // a bigger bubble both covers more area AND lingers on screen longer
    // (see the despawn condition above) - by the renewal-reward theorem,
    // setting each bubble's interval to (its own area*lifetime)/(voidRate *
    // field area) makes the long-run time-averaged on-screen area fraction
    // converge to voidRate regardless of the radius distribution
    const area = Math.PI * r * r;
    const travelDist = FIELD_H + 10 + 2 * r; // spawn (y=FIELD_Y-r) to despawn (y=FIELD_BOTTOM+10+r)
    const lifetime = travelDist / VOID_SPEED;
    voidSpawnTimer = (area * lifetime) / (simConfig.voidRate * FIELD_W * FIELD_H);
  }
}

// picks among the ①燃料(U235/U238/Pu) types only - B10 is spawned through its
// own independent pipeline (see B10_SPAWN_* below) so that ②燃料量 alone
// determines how much U235/U238 falls, unaffected by ③ほう酸濃度
function randomTargetType() {
  const uraniumFraction = 1 - simConfig.puEnrichment;
  const u235Fraction = uraniumFraction * simConfig.uraniumEnrichment;

  const r = Math.random();
  if (r < u235Fraction) return TYPE_U235;
  if (r < uraniumFraction) return TYPE_U238;
  return TYPE_PU;
}

// ---- game state ----
const STATE_TITLE = "title", STATE_PLAYING = "playing", STATE_GAMEOVER = "gameover";

let state = STATE_TITLE;
let keys = {};
// the shoot button (Z/Space/gamepad face buttons) is a hold-to-charge,
// release-to-fire control: holding it longer launches a slower ("charged")
// neutron instead of auto-firing repeatedly
let prevShootHeld = false;
let shootChargeT = 0;
let isChargingShoot = false; // mirrors shootHeld, read by drawPlayer() for the charge glow
const CHARGE_MAX_DURATION = 1.2; // seconds held for maximum charge
const CHARGE_MIN_SPEED_MULT = 0.35; // neutron speed multiplier at maximum charge
const OVERCHARGE_AUTOFIRE_DELAY = 0.1; // holding this much longer past max charge auto-fires a slow neutron and restarts the charge
let gameOverShootPresses = 0; // shoot button needs 2 releases on the game-over screen to restart (Enter restarts on 1)

// whatever key/button/tap/click just confirmed a title-screen start or a
// game-over restart shouldn't ALSO be read as "already holding the shoot
// button" once STATE_PLAYING begins. Resetting prevShootHeld alone only
// covers a press+release that both land within the same single frame - any
// real (human-speed) press is held for at least a few frames, during which
// prevShootHeld correctly flips true again, so the eventual release still
// reads as a normal shootReleased and fires a shot right after start.
// suppressNextShootRelease swallows exactly that one release regardless of
// how long the confirming press was held - see its use in update() below.
// Called at every resetGame() + state = STATE_PLAYING transition that could
// follow a shoot-button press.
let suppressNextShootRelease = false;
function resetShootHoldState() {
  shootChargeT = 0;
  prevShootHeld = false;
  isChargingShoot = false;
  suppressNextShootRelease = true;
  for (const [id, s] of touchSessions) {
    if (s.mode === "shoot") touchSessions.delete(id);
  }
  recomputeTouchShootHeld();
}
let learnQueued = false; // set on a fresh (non-repeat) learning-shot key press

// tiny "was this false last frame, true now" edge detector - shared by every
// press-once-per-tap control below (gamepad D-pad taps, the title config
// selector, the game-over decay-chain browser's cross-key selector) so each
// call site doesn't need its own `let prevX` plus the matching
// `if (x && !prevX) {...}; prevX = x;` boilerplate. reset() forces the next
// check() back to "not yet seen a press" without itself counting as an edge -
// used wherever a gating modifier (a shoulder button, Shift) being released
// should also cancel any edge in progress, not just stop feeding it
function makeEdgeTrigger() {
  let prev = false;
  return {
    check(current) {
      const edge = current && !prev;
      prev = current;
      return edge;
    },
    reset() {
      prev = false;
    },
  };
}

const gpLearnEdgeTrigger = makeEdgeTrigger(); // gamepad D-pad up (learning shot), see gpLearnEdge
const gpReleaseEdgeTrigger = makeEdgeTrigger(); // mirrors the above for D-pad down (吸収体 release), see gpReleaseEdge

// title-screen settings adjustment via gamepad: hold a shoulder button (the
// Shift equivalent) + D-pad left/right to select (edge-triggered - one tap,
// one step). Up/down (value adjustment, keyboard or gamepad) instead repeats
// continuously while held - see updateTitle().
const gpConfigLeftEdgeTrigger = makeEdgeTrigger(), gpConfigRightEdgeTrigger = makeEdgeTrigger();
let titleAdjustDir = 0; // -1/0/1, the currently-held value-adjust direction
let titleAdjustHeldT = 0; // seconds it's been held at that direction
const TITLE_ADJUST_REPEAT_DELAY = 0.4; // seconds before auto-repeat kicks in
const TITLE_ADJUST_REPEAT_INTERVAL = 0.08; // seconds between repeats once repeating

// game-over decay-chain browser: same modifier-held scheme as the title
// config panel (Shift / gamepad shoulder + cross-key selects, the shoot
// button drills in) - see updateGameOver(). ptDrillLevel is
// 0 (element grid) / 1 (that element's obtained isotopes) / 2 (the walked
// decay chain for one isotope); touch drives the same three levels directly
// by tapping cells instead of moving a cursor (see handleTouchStart()).
let ptDrillLevel = 0;
// separate top-level mode, entered by tapping the periodic-table grid's
// spacer cells (K/Ca/Sc/Ti - real cells but below PERIODIC_OBTAINABLE_MIN_Z,
// so otherwise permanently inert) - shows the "発見したレア核反応" list
// instead of whatever ptDrillLevel currently points at (see
// syncPeriodicTableDOM()'s early-return branch), then a tap anywhere in the
// panel backs out, same convention as level 2 -> 0
let ptRareMode = false;
let ptRarePage = 0; // current page within ptRareMode's list, see ptRareTotalPages()
let ptCursorZIndex = 0; // index into PERIODIC_OBTAINABLE_ELEMENTS, level 0 - or -1 for the rare-entry cell (see ptRareEntryZone())
let ptIsotopeList = []; // sorted A values of the drilled-into element, level 1+
let ptIsotopeIndex = 0; // index into ptIsotopeList, level 1
let ptChainSteps = null; // walkDecayChain() result being shown, level 2
let ptChainPage = 0; // current page within that chain, see ptChainTotalPages()/ptChainPageSteps()
const ptLeftEdgeTrigger = makeEdgeTrigger(), ptRightEdgeTrigger = makeEdgeTrigger(); // edge-detection for the Shift/shoulder+cross-key selector
const ptUpEdgeTrigger = makeEdgeTrigger(), ptDownEdgeTrigger = makeEdgeTrigger(); // same, for vertical movement across the element grid (level 0 only)
// true only while Shift/shoulder is actually held down (see updateGameOver()'s
// `ptBrowsing`) - drives both whether the cursor
// box/selected-chip highlight are drawn and which line the level-0 operation
// hint (ptHintEl, see positionGameOverOverlay()/syncPeriodicTableDOM())
// shows, so a keyboard/gamepad player who hasn't discovered the modifier key
// yet sees "hold Shift to select" instead of a highlight that doesn't do
// anything until they do
let ptCursorActive = false;
// mouse-only hover highlight (level 0 element index / level 1 isotope chip
// index, -1 = not hovering either) - updated from bindMouseEvents()'s
// mousemove listener (see updatePtMouseHover()) and drawn in
// drawPeriodicTablePanel()/syncPeriodicTableDOM() alongside the keyboard/
// gamepad cursor box. touch has no hover concept (a finger only ever
// "arrives" already tapping something), so this stays untouched - and
// unused - for touch; only lastInputDevice === "mouse" ever reads it.
let ptMouseHoverIdx = -1;
let ptMouseHoverIsotopeIdx = -1;
// separate from ptMouseHoverIdx because -1 already means "not hovering
// anything" there - this instead tracks the rare-entry cell (see
// ptRareEntryZone()) specifically, since it isn't part of
// PERIODIC_OBTAINABLE_ELEMENTS and so has no index of its own
let ptMouseHoverRareEntry = false;

// "learning shot" (↑ / gamepad D-pad up) speech-bubble log: shows what nuclear
// reaction just happened, fading out after LEARNING_LOG_DURATION seconds.
// The log is a plain DOM element, so nuclide names use a real <sup> tag for
// the mass number instead of the canvas-drawn superscript trick.
const LEARNING_LOG_DURATION = 5.5;
const LEARNING_LOG_SPEEDUP_STEP = 1.5; // added per suppressed event while a message is showing
const LEARNING_LOG_SPEEDUP_MAX = 6;
let learningLog = null; // { text (HTML), t, speedup, rare } or null
function logNuclearEvent(html, force, rare) {
  // don't interrupt/overwrite a message that's still showing, and don't queue
  // this one either - but each reaction that happens while it's still up makes
  // it count down faster, so a streak of learning shots clears through the
  // log quickly instead of leaving every message lingering for the full time.
  // force skips all of that and replaces whatever's showing immediately - for
  // rare events (see the delayed-neutron log call) that shouldn't ever be
  // silently swallowed just because an ordinary message happened to be up.
  // rare additionally gets the gold-glow box treatment (see syncLearningLogDOM())
  if (learningLog && !force) {
    learningLog.speedup = Math.min(LEARNING_LOG_SPEEDUP_MAX, learningLog.speedup + LEARNING_LOG_SPEEDUP_STEP);
    return;
  }
  learningLog = { text: html, t: 0, speedup: 1, rare: !!rare };
}
function isotopeHTML(mass, symbol) {
  return mass ? `<sup>${mass}</sup>${symbol}` : symbol;
}

let player, bullets, targets, items, explosions, particles, fragments;
let score, timeLeft, power, chainCount, chainMax, chainTimer, spawnTimer, b10SpawnTimer;
// "N連鎖！" popup just below the ship (see drawChainPopup()) - refreshed
// every time chainCount actually grows (registerChain()), not on every
// fission, so it reads as one continuous escalating banner during an active
// chain rather than restarting its fade each time. Deliberately anchored
// below the ship rather than floating loose in the field: bullets heading
// toward the ship get paddle-bounced right at the ship's own y-position, so
// that band stays comparatively uncluttered even during a busy chain,
// unlike the middle of the field where the actual fissions are happening
let chainPopupT = 0;
let chainPopupN = 0;
const CHAIN_POPUP_DURATION = 0.6;
// tracks whether the ship was inside a void bubble last frame, so entering/
// leaving one can be caught as an edge (see spawnSurfaceBreath/spawnWaterSplash).
// playerVoidBubble remembers which bubble it was, so the effect's spray
// direction can be based on where on that bubble the crossing happened, even
// after the bubble itself is no longer the one containing the ship (exit)
let playerInVoid = false;
let playerVoidBubble = null;
// caps the "気泡内では中性子の速さは遅くならない" learning-shot lesson at
// once per run - see its own comment where it's checked/set, in the bullet
// moderation loop
let voidSpeedLessonShown = false;
let fissionHistory = [];
// tallies every element obtained as a fission product this run, keyed by
// proton number Z - unlike fissionHistory (capped at 50 entries for the
// on-screen log), this accumulates for the whole play session so the
// game-over periodic-table panel reflects everything ever produced. Each
// entry also keeps a per-isotope (mass number A) breakdown, so the game-over
// decay-chain browser can drill from "which elements" down to "which actual
// isotopes" before walking a chain from a specific (Z,A).
let obtainedElements = new Map(); // Z -> { symbol, count, isotopes: Map<A, count> }
function recordObtainedElement(z, symbol, a) {
  let entry = obtainedElements.get(z);
  if (!entry) {
    entry = { symbol, count: 0, isotopes: new Map() };
    obtainedElements.set(z, entry);
  }
  entry.count++;
  entry.isotopes.set(a, (entry.isotopes.get(a) || 0) + 1);
}
// separate from obtainedElements: rare-event nuclides are almost always
// decay-chain daughters (see armFragmentDecayStep()), not the two direct
// fission products recordObtainedElement() tracks, so they need their own
// log rather than being forced into the periodic-table grid/chip UI - see
// the game-over "発見したレア核反応" screen (syncPeriodicTableDOM()'s
// ptRareMode branch), reachable via the periodic table panel's spacer cells
let rareEventLog = []; // ordered list of { z, a, type, mode, halfLife, ratio }, oldest first
let rareEventSeen = new Set(); // "z-a-type" dedup key - each pair logged once per run
// halfLife/ratio are this nuclide's own values for the branch that actually
// fired (see armFragmentDecayStep()'s f.pendingHalfLife/f.pendingRatio) -
// carried along purely for display (see formatHalfLife()/formatRatioPercent()
// in the rare-event log), not used for any further simulation logic
function recordRareEvent(z, a, type, mode, halfLife, ratio) {
  const key = `${z}-${a}-${type}`;
  if (rareEventSeen.has(key)) return;
  rareEventSeen.add(key);
  rareEventLog.push({ z, a, type, mode, halfLife, ratio });
}
// running totals for the whole play session: S = neutrons the ship itself
// fired (gen 1, blue/pink on screen), F = neutrons released by fission
// (gen >= 2, green on screen) - used for the game-over "neutron multiplication
// factor" k = F/(F+S)
let totalPlayerNeutrons = 0;
let totalFissionNeutrons = 0;
// shared by the game-over readout (syncGameOverDOM()) and recordRun() (see
// the timeLeft<=0 branch in updatePlaying()) so both use the exact same formula
function computeMultFactor() {
  const neutronTotal = totalFissionNeutrons + totalPlayerNeutrons;
  return neutronTotal > 0 ? totalFissionNeutrons / neutronTotal : 0;
}
let fieldScrollY = 0;
let screenShake = 0;
// "反射体" (reflector) power-up: while active, neutrons that reach the
// playfield's outer edges scatter back inward instead of leaving the screen
const BARRIER_DURATION = 8; // seconds
let barrierT = 0;
// "吸収体" (absorber) power-up: while active, the ship's own paddle-bounce
// (see paddleBounceBullet()) absorbs a neutron instead of bouncing it back -
// same duration/no-stacking convention as the reflector above, just applied
// to the ship's own catch instead of the field's outer edges
const ABSORBER_DURATION = 16; // seconds - ends early instead if a 反射体 is picked up mid-absorption, see items pickup handling
let absorberT = 0;
// 吸収体's own share of maybeSpawnItem()'s "not star" roll (see below) -
// starts at 0 every run (吸収体 can't appear at all yet), climbs by
// ABSORBER_CHANCE_STEP with each 反射体 pickup up to ABSORBER_CHANCE_MAX,
// and drops back to 0 the moment a 吸収体 is actually picked up. This comes
// entirely out of 星(star)'s share, never 反射体's own - REFLECTOR_CHANCE
// below stays fixed no matter how many 反射体/吸収体 have been collected,
// so getting a 反射体 never makes the next 反射体 harder to find.
const ABSORBER_CHANCE_STEP = 0.02;
const ABSORBER_CHANCE_MAX = 0.05; // same ceiling REFLECTOR_CHANCE itself sits at
let absorberChance = 0;
// hidden 吸収体 payoff: every neutron the ship swallows while absorbing (see
// the ship-as-paddle handling below) is tallied here by its generation
// (b.gen) instead of just vanishing. ArrowDown (releaseQueued, mirroring
// ArrowUp's learnQueued) fires the whole stash back out at once via
// releaseAbsorbedNeutrons() - see its own comment for the payoff/angle-safety
// details, and can be triggered at any time, in or out of an active 吸収体
// window. A persistent bank, not a per-window gamble: it survives absorberT
// reverting to 0 (timing out or an early 反射体 cancel) and keeps growing
// across as many 吸収体 windows as happen in one run - only a full run
// reset clears it, so patient hoarding across the whole run is rewarded.
let absorbedNeutronsByGen = {};
let releaseQueued = false; // set on a fresh (non-repeat) ArrowDown press

// ---- player name + high score record (persisted offline via localStorage) ----
// three independent rankings are kept - 得点(score), 連鎖数(max chain), and
// 増倍率(the same session-long k stand-in shown on the game-over screen, see
// syncGameOverDOM()) - since the "best run" for each isn't necessarily the
// same play session
const PLAYER_NAME_KEY = "nshooter_playerName";
const SCORE_RECORD_KEY = "nshooter_topScores";
const CHAIN_RECORD_KEY = "nshooter_topChains";
const MULT_RECORD_KEY = "nshooter_topMult";
const MAX_RECORDS = 5;
const DEFAULT_PLAYER_NAME = "YOU";
// shared by drawHighScorePanel(), positionTitleOverlay(), and
// titleNameHitZone() - all three must agree on the same panel geometry
const HS_PANEL_W = 580, HS_PANEL_H = 122;

// pre-seeded placeholder rankings (nuclear-fission-history easter egg for the
// chain/mult columns) shown until real play sessions push them off the list
const DEFAULT_SCORE_RECORDS = [
  { name: "😊", score: 2525 },
  { name: "🧑‍🔬", score: 1031 },
  { name: "なごや", score: 758 },
];
const DEFAULT_CHAIN_RECORDS = [
  { name: "フェルミ", chainMax: 4 },
  { name: "マイトナー", chainMax: 3 },
  { name: "ハーン", chainMax: 2 },
];
// deliberately low/easy-to-beat (unlike a real k approaching 1.0) so a first
// real play session can knock these off the list right away - no historical
// name attached, since a low placeholder value paired with a real reactor
// pioneer's name would read as a mismatch (see DEFAULT_CHAIN_RECORDS for
// where that flavor of easter egg actually lives)
const DEFAULT_MULT_RECORDS = [
  { name: "🥇", mult: 0.3 },
  { name: "🥈", mult: 0.2 },
  { name: "🥉", mult: 0.1 },
];

let playerName = localStorage.getItem(PLAYER_NAME_KEY) || "";
let nameEntryOpen = false;
let lastRunScoreRank = -1; // 1-based rank of the just-finished run's score, -1 if it didn't place
let lastRunChainRank = -1; // same, for the run's max chain count
let lastRunMultRank = -1; // same, for the run's 増倍率 (see syncGameOverDOM())

function loadRecordList(key, defaults) {
  try {
    const raw = JSON.parse(localStorage.getItem(key));
    return Array.isArray(raw) ? raw : defaults.map((r) => ({ ...r }));
  } catch {
    return defaults.map((r) => ({ ...r }));
  }
}

function loadScoreRecords() {
  return loadRecordList(SCORE_RECORD_KEY, DEFAULT_SCORE_RECORDS);
}

function loadChainRecords() {
  return loadRecordList(CHAIN_RECORD_KEY, DEFAULT_CHAIN_RECORDS);
}

function loadMultRecords() {
  return loadRecordList(MULT_RECORD_KEY, DEFAULT_MULT_RECORDS);
}

// inserts this run's result into all three rankings independently and
// returns the 1-based rank achieved in each (-1 if it didn't make the top
// MAX_RECORDS)
function recordRun(name, finalScore, finalChainMax, finalMult) {
  const scoreList = loadScoreRecords();
  const newScoreEntry = { name, score: finalScore };
  scoreList.push(newScoreEntry);
  scoreList.sort((a, b) => b.score - a.score);
  const scoreRank = scoreList.indexOf(newScoreEntry);
  scoreList.length = Math.min(scoreList.length, MAX_RECORDS);
  localStorage.setItem(SCORE_RECORD_KEY, JSON.stringify(scoreList));

  const chainList = loadChainRecords();
  const newChainEntry = { name, chainMax: finalChainMax };
  chainList.push(newChainEntry);
  chainList.sort((a, b) => b.chainMax - a.chainMax);
  const chainRank = chainList.indexOf(newChainEntry);
  chainList.length = Math.min(chainList.length, MAX_RECORDS);
  localStorage.setItem(CHAIN_RECORD_KEY, JSON.stringify(chainList));

  const multList = loadMultRecords();
  const newMultEntry = { name, mult: finalMult };
  multList.push(newMultEntry);
  multList.sort((a, b) => b.mult - a.mult);
  const multRank = multList.indexOf(newMultEntry);
  multList.length = Math.min(multList.length, MAX_RECORDS);
  localStorage.setItem(MULT_RECORD_KEY, JSON.stringify(multList));

  return {
    scoreRank: scoreRank < MAX_RECORDS ? scoreRank + 1 : -1,
    chainRank: chainRank < MAX_RECORDS ? chainRank + 1 : -1,
    multRank: multRank < MAX_RECORDS ? multRank + 1 : -1,
  };
}

// ---- hidden ranking-reset gesture (title screen only) ----
// deliberately NOT shown in the on-screen control hints, and deliberately
// NOT reusing any existing title-screen input (Enter/Z/Space/tap = start,
// Shift+arrows = sim settings, [C]/long-press/right-click on the ranking
// panel = rename) - meant for exhibition use, where it must survive a lot of
// casual/curious mashing without ever firing by accident. Each input device
// gets its own "hold" gesture that's otherwise unused on this screen:
//   keyboard: hold R
//   mouse: hold the right button
//   touch: hold with two fingers at once
//   gamepad: hold Select/Back (button 8)
// requires two separate ~5s holds with a genuine release in between (not one
// long hold) specifically so a stuck key, a bag resting on a button, or a
// held-down phone screen can't ever complete it on its own - see
// rankingResetPhase's state machine in updateRankingResetGesture()
const RANKING_RESET_HOLD_DURATION = 5; // seconds per hold
const RANKING_RESET_CONFIRM_WINDOW = 5; // seconds allowed between the two holds
const GAMEPAD_BTN_RESET_HOLD = 8; // Select/Back - unused by every other control
let rankingResetPhase = "idle"; // idle -> holding1 -> waitingRelease -> waitingConfirm -> holding2 -> idle
let rankingResetT = 0;

function updateRankingResetGesture(dt, active) {
  switch (rankingResetPhase) {
    case "idle":
      if (active) { rankingResetPhase = "holding1"; rankingResetT = 0; }
      break;
    case "holding1":
      if (!active) { rankingResetPhase = "idle"; break; }
      rankingResetT += dt;
      if (rankingResetT >= RANKING_RESET_HOLD_DURATION) rankingResetPhase = "waitingRelease";
      break;
    case "waitingRelease":
      // first hold already completed - ignore continued holding, wait for an
      // actual release before the confirm hold is allowed to start
      if (!active) { rankingResetPhase = "waitingConfirm"; rankingResetT = RANKING_RESET_CONFIRM_WINDOW; }
      break;
    case "waitingConfirm":
      if (active) { rankingResetPhase = "holding2"; rankingResetT = 0; break; }
      rankingResetT -= dt;
      if (rankingResetT <= 0) rankingResetPhase = "idle"; // timed out waiting for the confirm hold
      break;
    case "holding2":
      if (!active) { rankingResetPhase = "idle"; break; }
      rankingResetT += dt;
      if (rankingResetT >= RANKING_RESET_HOLD_DURATION) {
        localStorage.removeItem(SCORE_RECORD_KEY);
        localStorage.removeItem(CHAIN_RECORD_KEY);
        localStorage.removeItem(MULT_RECORD_KEY);
        rankingResetPhase = "idle";
        rankingResetT = 0;
      }
      break;
  }
}

const nameEntryOverlayEl = document.getElementById("nameEntryOverlay");
const nameEntryInputEl = document.getElementById("nameEntryInput");
const nameEntryConfirmEl = document.getElementById("nameEntryConfirm");

function openNameEntry() {
  nameEntryOpen = true;
  if (nameEntryOverlayEl) nameEntryOverlayEl.classList.remove("hidden");
  if (nameEntryInputEl) {
    nameEntryInputEl.value = playerName;
    nameEntryInputEl.focus();
    nameEntryInputEl.select();
  }
}

function confirmNameEntry() {
  const raw = nameEntryInputEl ? nameEntryInputEl.value.trim() : "";
  playerName = raw.slice(0, 10) || DEFAULT_PLAYER_NAME;
  localStorage.setItem(PLAYER_NAME_KEY, playerName);
  nameEntryOpen = false;
  if (nameEntryOverlayEl) nameEntryOverlayEl.classList.add("hidden");
}

if (nameEntryConfirmEl) nameEntryConfirmEl.addEventListener("click", confirmNameEntry);
if (nameEntryInputEl) {
  nameEntryInputEl.addEventListener("keydown", (e) => {
    if (e.code === "Enter" || e.code === "NumpadEnter") confirmNameEntry();
    e.stopPropagation();
  });
}
if (!playerName) openNameEntry();
const FIELD_SCROLL_SPEED = 55; // px/s, downward drift of the starfield (matches power item fall speed)

// hard ceiling on every shake trigger, no matter the call site - during a
// fast chain reaction, triggerScreenShake() can be called many times faster
// than the shake decays (see its Math.max below), so what actually matters
// for comfort is this ceiling, not any individual call's requested magnitude
const SCREEN_SHAKE_MAX = 6;
function triggerScreenShake(mag) {
  screenShake = Math.max(screenShake, Math.min(SCREEN_SHAKE_MAX, mag));
}

// chain-highlight glow thresholds (see updateBulletPhysics()'s per-frame
// auraGlowT pass and drawBullets()) - the glow only ever turns on past this generation depth
const CHAIN_AURA_MIN_GEN = 6;
const CHAIN_AURA_RAMP_UP_RATE = 1 / 0.15; // reaches full brightness in ~0.15s
const CHAIN_AURA_DECAY_RATE = 1 / 1.5; // fades back to nothing over ~1.5s

function resetGame() {
  player = {
    x: FIELD_X + FIELD_W / 2,
    y: FIELD_BOTTOM - 36,
    w: 33, h: 30,
    speed: 220,
    shotCooldown: 0,
    squashT: 0,
    triWayT: 0,
  };
  bullets = [];
  targets = [];
  items = [];
  explosions = [];
  particles = [];
  fragments = [];
  screenShake = 0;
  barrierT = 0;
  absorberT = 0;
  absorbedNeutronsByGen = {};
  absorberChance = 0;
  voidBands = [];
  voidSpawnTimer = 0;
  playerInVoid = false;
  playerVoidBubble = null;
  voidSpeedLessonShown = false;
  fissionHistory = [];
  obtainedElements = new Map();
  rareEventLog = [];
  rareEventSeen = new Set();
  ptDrillLevel = 0;
  ptRareMode = false;
  ptRarePage = 0;
  ptCursorZIndex = 0;
  ptIsotopeList = [];
  ptIsotopeIndex = 0;
  ptChainSteps = null;
  ptChainPage = 0;
  ptCursorActive = false;
  ptMouseHoverIdx = -1;
  ptMouseHoverIsotopeIdx = -1;
  ptMouseHoverRareEntry = false;
  totalPlayerNeutrons = 0;
  totalFissionNeutrons = 0;
  fissionABins = fissionABins.map(() => 0);
  fissionABinMax = 1;
  floatingLabels = [];
  floatingLabelCooldown = 0;
  learningLog = null;
  score = 0;
  timeLeft = simConfig.operationTime;
  power = 0;
  chainCount = 0;
  chainMax = 0;
  chainTimer = 0;
  chainPopupT = 0;
  chainPopupN = 0;
  spawnTimer = 0;
  b10SpawnTimer = 0;
  // seed the field with some initial targets (fuel + a proportional amount of B10)
  for (let i = 0; i < 10; i++) {
    spawnTarget(Math.random() * FIELD_H);
  }
  const initialB10 = Math.round(B10_MAX_TARGETS_AT_MAX * simConfig.b10Concentration * 0.4);
  for (let i = 0; i < initialB10; i++) {
    spawnTarget(Math.random() * FIELD_H, TYPE_B10);
  }
}

function spawnTarget(yOverride, forceType) {
  const x = FIELD_X + 20 + Math.random() * (FIELD_W - 40);
  const y = yOverride !== undefined ? FIELD_Y + yOverride : FIELD_Y - 20;
  targets.push({
    x, y,
    type: forceType !== undefined ? forceType : randomTargetType(),
    vy: 25 + Math.random() * 35,
    vx: (Math.random() * 2 - 1) * 20,
    wobbleAge: Math.random() * 10,
    wobbleFreq: 1.2 + Math.random() * 1.0,
    wobbleAccel: 40 + Math.random() * 40,
    spawnT: 0,
  });
}

function fireCooldownFor(power) {
  return Math.max(150, 420 - power * 2.7);
}

// how many of the player's OWN neutrons (gen 1) may be alive on screen at
// once - starts sparse and loosens up as Power increases
function maxPlayerBulletsFor(power) {
  return Math.round(3 + (power / 100) * 7); // 3 at Power 0, up to 10 at Power 100
}

// picking up a power star while already at max Power grants a brief 3-way
// shot instead - fire rate is eased off a little as a tradeoff for the extra shots
const TRI_WAY_DURATION = 5; // seconds - once it runs out, TRI_WAY_POWER_REFUND is docked
// from Power (see its countdown below), so re-triggering isn't as simple as
// just tapping one more star right away
const TRI_WAY_COOLDOWN_MULT = 1.4;
const TRI_WAY_SPREAD_DEG = 16;
const TRI_WAY_POWER_COST = 30; // 2 stars' worth (+15 each)

function shoot(isLearning, chargeT) {
  if (player.shotCooldown > 0) return;
  const playerBulletCount = bullets.reduce((n, b) => n + (b.gen === 1 ? 1 : 0), 0);
  if (playerBulletCount >= maxPlayerBulletsFor(power)) return;

  const triWay = player.triWayT > 0;
  player.shotCooldown = fireCooldownFor(power) * (triWay ? TRI_WAY_COOLDOWN_MULT : 1);
  player.squashT = 0.12;

  // holding the shoot button before releasing charges the shot: a longer hold
  // launches a slower neutron (capped at CHARGE_MAX_DURATION of charging)
  const chargeFrac = Math.min(1, (chargeT || 0) / CHARGE_MAX_DURATION);
  const speedMult = 1 - (1 - CHARGE_MIN_SPEED_MULT) * chargeFrac;
  // a fully-charged shot is guaranteed to react on contact - it's meant to
  // read as "already thermalized", not just "somewhat more likely to react"
  const guaranteedReaction = chargeFrac >= 1;
  const baseX = player.x, baseY = player.y - player.h / 2, speed = 480 * speedMult;
  const angles = triWay ? [-TRI_WAY_SPREAD_DEG, 0, TRI_WAY_SPREAD_DEG] : [0];
  for (const deg of angles) {
    const rad = (deg * Math.PI) / 180;
    bullets.push({
      x: baseX, y: baseY,
      vx: Math.sin(rad) * speed, vy: -Math.cos(rad) * speed,
      gen: 1,
      speed0: speed, distTraveled: 0,
      learning: !!isLearning,
      guaranteedReaction,
    });
  }
  totalPlayerNeutrons += angles.length;
}

function sampleNeutronYield(dist) {
  const r = Math.random();
  let cum = 0;
  for (let i = 0; i < dist.length; i++) {
    cum += dist[i];
    if (r < cum) return i;
  }
  return dist.length - 1;
}

function spawnFissionNeutrons(x, y, gen, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 230 + Math.random() * 140;
    bullets.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      gen: gen + 1,
      speed0: speed, distTraveled: 0,
    });
  }
  totalFissionNeutrons += count;
}

// 吸収体's hidden payoff: fires the whole absorbedNeutronsByGen stash back
// out from the ship at once (see ArrowDown/releaseQueued). Each released
// neutron keeps the generation it was absorbed at, so a stash built from
// deep chains pays off with a matching gen-based score multiplier once it
// goes on to cause more fissions - the visual speed bump per generation
// (higher gen = faster) is the same cue, just seen immediately on release.
//
// angle is constrained per-shot to whatever's actually safe from the ship's
// CURRENT x - not a fixed cone - because the field is taller than it is
// wide (dy from the paddle to the top edge is ~412px vs ~368px of width),
// so a fixed wide fan would let shots exit through the side walls well
// before reaching the top. atan2(distance-to-that-wall, dy) is the exact
// per-side limit at which a straight shot grazes the wall exactly as it
// reaches FIELD_Y, so sampling inside [-maxAngleLeft, maxAngleRight]
// guarantees every released neutron stays in-bounds for its full flight.
function releaseAbsorbedNeutrons() {
  const gens = Object.keys(absorbedNeutronsByGen);
  if (gens.length === 0) return;
  const dy = Math.max(1, player.y - FIELD_Y);
  const maxAngleLeft = Math.atan2(player.x - FIELD_X, dy);
  const maxAngleRight = Math.atan2(FIELD_RIGHT - player.x, dy);
  const originY = player.y - player.h / 2;
  let totalReleased = 0;
  for (const genKey of gens) {
    const gen = Number(genKey);
    const count = absorbedNeutronsByGen[genKey];
    const speed = 260 + (gen - 1) * 40;
    for (let i = 0; i < count; i++) {
      const angle = -maxAngleLeft + Math.random() * (maxAngleLeft + maxAngleRight);
      bullets.push({
        x: player.x, y: originY,
        vx: Math.sin(angle) * speed,
        vy: -Math.cos(angle) * speed,
        gen,
        speed0: speed, distTraveled: 0,
        released: true,
      });
    }
    totalReleased += count;
  }
  absorbedNeutronsByGen = {};
  spawnExplosion(player.x, originY, true);
  triggerScreenShake(SCREEN_SHAKE_MAX);
}

// ---- score calculation ----
// every neutron-hit scoring event (fission, U238 capture, B10 capture) pays
// `base points x genScoreMultiplier(gen)`, where `gen` is the CAUSING
// neutron's own generation (1 = the player's own shot, 2+ = born from an
// earlier fission). The multiplier grows linearly with generation and is
// deliberately left uncapped - a long-sustained chain is rare and skill/luck-
// dependent, so it's meant to pay off disproportionately. Item pickups
// (star/reflector/absorber) are a flat +1 each instead, since they aren't
// caused by a neutron of any particular generation.
const GEN_SCORE_BASE = 20; // fission
const CAPTURE_U238_SCORE_BASE = 5; // U238 -> Pu capture
const CAPTURE_B10_SCORE_BASE = 3; // B10(n,alpha) capture
const CAPTURE_POISON_SCORE_BASE = 1; // poison nuclide (n,gamma) capture - see updateFragments()
const GEN_SCORE_STEP = 1.5;
function genScoreMultiplier(gen) {
  return 1 + (gen - 1) * GEN_SCORE_STEP;
}
function awardNeutronScore(base, gen) {
  return Math.round(base * genScoreMultiplier(gen));
}

// ---- visual effect spawners (particles) ----
function spawnExplosion(x, y, big) {
  explosions.push({ x, y, t: 0, dur: big ? 0.4 : 0.22, big });
  const count = big ? 12 : 6;
  const baseSpeed = big ? 160 : 90;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = baseSpeed * (0.5 + Math.random() * 0.8);
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      t: 0, dur: 0.35 + Math.random() * 0.25,
      size: big ? 3 + Math.random() * 3 : 2 + Math.random() * 2,
      color: big ? (Math.random() < 0.5 ? "#ffd23f" : "#ff8a3d") : "#ffe9a8",
    });
  }
  // kept well under SCREEN_SHAKE_MAX - a fast chain reaction can call this
  // many times a second, faster than the shake decays below, so a low
  // per-hit value is what keeps that moment a mild rumble instead of a
  // sustained, nausea-inducing buzz
  if (big) triggerScreenShake(3);
}

// the whole playfield reads as "water" (see COLORS.playfieldBg), with void
// bubbles as pockets of air - so the ship crossing that boundary gets a
// directional burst of bubble/splash particles instead of silently entering
// a zone with different neutron-moderation behavior

// dx/dy is the crossing bubble's center-to-player vector at the moment of the
// transition (see bubbleContaining()/update()) - it points toward whichever
// side of the bubble the ship actually broke through, so the burst direction
// tracks the real inflow/outflow geometry instead of always firing straight
// up. Falls back to straight up if no direction is available (dx=dy=0).
function directionAngle(dx, dy, fallback) {
  return dx === 0 && dy === 0 ? fallback : Math.atan2(dy, dx);
}

function spawnSurfaceBreath(x, y, dx, dy) {
  // bubbles rise back the way the ship came from (opposite the crossing vector)
  const baseAngle = directionAngle(-dx, -dy, -Math.PI / 2);
  for (let i = 0; i < 5; i++) {
    const angle = baseAngle + (Math.random() - 0.5) * 1.4;
    const speed = 30 + Math.random() * 30;
    particles.push({
      x: x + (Math.random() - 0.5) * 10, y,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      t: 0, dur: 0.5 + Math.random() * 0.3,
      size: 1.5 + Math.random() * 2,
      color: "#ffffff",
    });
  }
}

function spawnWaterSplash(x, y, dx, dy) {
  // splash flies onward in the direction the ship was crossing when it dove back in
  const baseAngle = directionAngle(dx, dy, -Math.PI / 2);
  for (let i = 0; i < 8; i++) {
    const angle = baseAngle + (Math.random() - 0.5) * Math.PI * 0.9;
    const speed = 60 + Math.random() * 70;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      t: 0, dur: 0.3 + Math.random() * 0.25,
      size: 1.5 + Math.random() * 2.5,
      color: Math.random() < 0.5 ? "#bfe8ff" : "#eafbff",
    });
  }
}

// a small dark burst where a neutron was just absorbed by the ship (see
// absorberT in updateBulletPhysics()'s ship-as-paddle handling) - otherwise the bullet
// would simply vanish with no acknowledgment at all, unlike every other way
// a neutron can be consumed in this game (explosion, capture trail, etc.)
function spawnAbsorptionPoof(x, y) {
  for (let i = 0; i < 6; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 25 + Math.random() * 35;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      t: 0, dur: 0.25 + Math.random() * 0.2,
      size: 1.5 + Math.random() * 2,
      color: Math.random() < 0.5 ? "#2a2a2a" : "#555555",
    });
  }
}

// ---- item drops ----
const ITEM_TYPE_STAR = "star", ITEM_TYPE_REFLECTOR = "reflector", ITEM_TYPE_ABSORBER = "absorber";

// fixed, deliberately never adjusted at runtime - see absorberChance's own
// comment for why 反射体's own odds have to stay constant
const REFLECTOR_CHANCE = 0.05;

function maybeSpawnItem(x, y) {
  if (Math.random() < 0.14) {
    // the power star is the common case; a small fraction of the time it's
    // instead a rarer power-up - "反射体" (reflector, temporary field-edge
    // barrier) at a fixed REFLECTOR_CHANCE, or "吸収体" (absorber,
    // temporarily turns the ship's own paddle-bounce into an absorption
    // instead) at the currently-climbed absorberChance (0 until a 反射体 has
    // been picked up at least once - see its own comment). Both are carved
    // out of the same roll so their two chances never overlap.
    let type = ITEM_TYPE_STAR;
    const roll = Math.random();
    if (roll < REFLECTOR_CHANCE) type = ITEM_TYPE_REFLECTOR;
    else if (roll < REFLECTOR_CHANCE + absorberChance) type = ITEM_TYPE_ABSORBER;
    items.push({ x, y, vy: 55, spin: 0, type });
  }
}

// ---- chain-reaction bookkeeping ----
function registerChain(gen) {
  if (gen > chainCount) {
    chainCount = gen;
    chainPopupN = chainCount;
    chainPopupT = CHAIN_POPUP_DURATION;
  }
  chainMax = Math.max(chainMax, chainCount);
  chainTimer = 1.4;
}

// ---- main update loop ----
function update(dt) {
  fieldScrollY += dt * FIELD_SCROLL_SPEED;
  // faster decay than before (was *50) so each trigger reads as a short,
  // discrete jolt rather than a lingering wobble even when re-triggered
  // often during a fast chain reaction
  if (screenShake > 0) screenShake = Math.max(0, screenShake - dt * 90);
  const gp = pollGamepad();
  if (gp && gamepadHasActivity(gp)) lastInputDevice = "gamepad";
  // on a gamepad, the shoot button doubles as "Enter" for start/retry
  const gpConfirm = !!gp && gamepadShootPressed(gp);

  // shoot button: hold to charge, release to fire (works the same whether
  // held via keyboard, gamepad, or touch) - a charged release launches a slower neutron
  const shootHeld = keys["KeyZ"] || keys["Space"] || (!!gp && gamepadShootPressed(gp)) || touchShootHeld;
  if (shootHeld && !prevShootHeld) shootChargeT = 0;
  if (shootHeld) shootChargeT += dt;
  isChargingShoot = shootHeld;
  // touchShootSuppressRelease: set when an in-progress shoot touch was just
  // reclassified as an upward flick (learning shot) rather than a release -
  // without this, the same touchShootHeld->false transition that consumed the
  // flick would ALSO read as a normal release and fire a second, redundant shot
  const shootReleased = !shootHeld && prevShootHeld && !touchShootSuppressRelease && !suppressNextShootRelease;
  touchShootSuppressRelease = false;
  // the swallowed release just happened (button's finally back up) - stop
  // suppressing so every later press/release cycle behaves normally
  if (!shootHeld && suppressNextShootRelease) suppressNextShootRelease = false;
  const chargeAtRelease = shootChargeT;
  // holding well past full charge auto-fires a max-charge (slow) neutron and
  // immediately restarts the charge, so just holding the button streams slow neutrons
  let autoFireCharged = false;
  if (shootHeld && shootChargeT >= CHARGE_MAX_DURATION + OVERCHARGE_AUTOFIRE_DELAY) {
    autoFireCharged = true;
    shootChargeT = 0;
  }
  prevShootHeld = shootHeld;

  // same edge-detection for the learning-shot button (gamepad D-pad up)
  const gpLearnDown = !!gp && gamepadDpadUpPressed(gp);
  const gpLearnEdge = gpLearnEdgeTrigger.check(gpLearnDown);

  // mirror image of the above for D-pad down (吸収体 release) - same
  // edge-detection, opposite direction, matching ArrowUp/ArrowDown on
  // keyboard and the up/down flick on mouse/touch
  const gpReleaseDown = !!gp && gamepadDpadDownPressed(gp);
  const gpReleaseEdge = gpReleaseEdgeTrigger.check(gpReleaseDown);

  if (learningLog) {
    learningLog.t += dt * learningLog.speedup;
    if (learningLog.t >= LEARNING_LOG_DURATION) learningLog = null;
  }

  if (state === STATE_TITLE && nameEntryOpen) {
    learnQueued = false;
    releaseQueued = false;
    return;
  }
  if (state === STATE_TITLE) {
    updateTitle(dt, gp, gpConfirm);
    return;
  }
  if (state === STATE_GAMEOVER) {
    updateGameOver(dt, gp, shootReleased);
    return;
  }

  updatePlaying(dt, gp, shootReleased, chargeAtRelease, autoFireCharged, gpLearnEdge, gpReleaseEdge);
}

function updateTitle(dt, gp, gpConfirm) {
  learnQueued = false;
  releaseQueued = false;

  // gamepad equivalent of holding Shift: hold a shoulder button (LB/RB)
  // while tapping D-pad left/right to select (one tap, one step)
  if (gp && gamepadShoulderHeld(gp)) {
    const dpadX = gamepadDpadX(gp);
    const leftNow = dpadX < 0, rightNow = dpadX > 0;
    if (gpConfigLeftEdgeTrigger.check(leftNow)) selectTitleConfig(-1);
    if (gpConfigRightEdgeTrigger.check(rightNow)) selectTitleConfig(1);
  } else {
    gpConfigLeftEdgeTrigger.reset();
    gpConfigRightEdgeTrigger.reset();
  }

  // value adjustment (Shift+↑/↓ on keyboard, shoulder+D-pad up/down on
  // gamepad) repeats continuously while held instead of needing a fresh
  // press per step: an immediate nudge on press, then a steady repeat
  // rate after a short delay - the same feel as OS key-repeat
  const shiftHeld = keys["ShiftLeft"] || keys["ShiftRight"];
  const gpAdjustHeld = !!gp && gamepadShoulderHeld(gp);
  let adjustDir = 0;
  if (shiftHeld && keys["ArrowUp"]) adjustDir = 1;
  else if (shiftHeld && keys["ArrowDown"]) adjustDir = -1;
  else if (gpAdjustHeld && gamepadDpadUpPressed(gp)) adjustDir = 1;
  else if (gpAdjustHeld && gamepadDpadDownPressed(gp)) adjustDir = -1;

  if (adjustDir !== 0) {
    if (adjustDir !== titleAdjustDir) {
      adjustTitleConfig(adjustDir);
      titleAdjustHeldT = 0;
    } else {
      titleAdjustHeldT += dt;
      if (titleAdjustHeldT >= TITLE_ADJUST_REPEAT_DELAY) {
        titleAdjustHeldT -= TITLE_ADJUST_REPEAT_INTERVAL;
        adjustTitleConfig(adjustDir);
      }
    }
  } else {
    titleAdjustHeldT = 0;
  }
  titleAdjustDir = adjustDir;

  // hidden ranking-reset gesture - see updateRankingResetGesture()'s own
  // comment for why each device gets its own otherwise-unused "hold"
  const activeTouchCount = [...touchSessions.keys()].filter((id) => id !== MOUSE_ID).length;
  const twoFingerHeld = activeTouchCount >= 2;
  const rankingResetHoldActive =
    keys["KeyR"] || rightMouseDown || twoFingerHeld || (!!gp && gamepadButtonPressed(gp, GAMEPAD_BTN_RESET_HOLD));
  updateRankingResetGesture(dt, rankingResetHoldActive);

  // touch's tap-to-start fires on release, from handleTouchEnd() - see its
  // own comment for why (a live per-frame check here can't tell a fast tap
  // from the start of a two-finger hold without either misfiring or
  // missing quick taps entirely). Keyboard/gamepad stay instant, per-frame.
  const nonTouchConfirm = keys["Enter"] || keys["NumpadEnter"] || keys["Space"] || keys["KeyZ"] || gpConfirm;
  if (nonTouchConfirm) {
    resetGame();
    state = STATE_PLAYING;
    resetShootHoldState();
  }
}

function updateGameOver(dt, gp, shootReleased) {
  learnQueued = false;
  releaseQueued = false;

  // decay-chain browser (keyboard/gamepad): the same modifier-held scheme
  // as the title config panel (Shift / gamepad shoulder + left/right moves
  // the cursor, edge-triggered like selectTitleConfig). The shoot button,
  // while that modifier is held, drills one level deeper instead of
  // counting toward a restart - see ptNavigate()/ptDrillConfirm() and
  // PT_PANEL's touch equivalent in handleTouchStartGameOver().
  const ptShiftHeld = keys["ShiftLeft"] || keys["ShiftRight"];
  const ptGpHeld = !!gp && gamepadShoulderHeld(gp);
  const ptBrowsing = ptShiftHeld || ptGpHeld;
  ptCursorActive = ptBrowsing;
  if (ptBrowsing) {
    const dpadX = gp ? gamepadDpadX(gp) : 0;
    const leftNow = keys["ArrowLeft"] || dpadX < 0;
    const rightNow = keys["ArrowRight"] || dpadX > 0;
    const upNow = keys["ArrowUp"] || (!!gp && gamepadDpadUpPressed(gp));
    const downNow = keys["ArrowDown"] || (!!gp && gamepadDpadDownPressed(gp));
    const leftEdge = ptLeftEdgeTrigger.check(leftNow);
    const rightEdge = ptRightEdgeTrigger.check(rightNow);
    const upEdge = ptUpEdgeTrigger.check(upNow);
    const downEdge = ptDownEdgeTrigger.check(downNow);
    // any actual cursor move counts as "used the browser", not just holding
    // the modifier - see the shootReleased/ptBrowsing branch below for why
    // this resets gameOverShootPresses too
    if (ptRareMode) {
      // left/right page back/forth instead of moving the (invisible, see
      // drawPeriodicTablePanel()'s early return) grid cursor while browsing
      // the rare-event log - up/down have no meaning here, same as level 1
      const totalPages = ptRareTotalPages();
      if (leftEdge) { ptRarePage = (ptRarePage - 1 + totalPages) % totalPages; gameOverShootPresses = 0; }
      if (rightEdge) { ptRarePage = (ptRarePage + 1) % totalPages; gameOverShootPresses = 0; }
    } else if (ptDrillLevel === 2) {
      // same repurposing as ptRareMode above - left/right had no effect at
      // level 2 before (ptNavigate()/ptNavigateVertical() both only act on
      // level 0/1), so this doesn't take anything away from existing behavior
      const totalPages = ptChainTotalPages();
      if (leftEdge) { ptChainPage = (ptChainPage - 1 + totalPages) % totalPages; gameOverShootPresses = 0; }
      if (rightEdge) { ptChainPage = (ptChainPage + 1) % totalPages; gameOverShootPresses = 0; }
    } else {
      if (leftEdge) { ptNavigate(-1); gameOverShootPresses = 0; }
      if (rightEdge) { ptNavigate(1); gameOverShootPresses = 0; }
      if (upEdge) { ptNavigateVertical(-1); gameOverShootPresses = 0; }
      if (downEdge) { ptNavigateVertical(1); gameOverShootPresses = 0; }
    }
  } else {
    ptLeftEdgeTrigger.reset();
    ptRightEdgeTrigger.reset();
    ptUpEdgeTrigger.reset();
    ptDownEdgeTrigger.reset();
  }

  if (keys["Enter"] || keys["NumpadEnter"]) {
    // Enter restarts immediately (1 press)
    gameOverShootPresses = 0;
    resetGame();
    state = STATE_PLAYING;
    resetShootHoldState(); // in case the shoot button/touch is also still held right now
  } else if (shootReleased && ptBrowsing) {
    // the rare-entry cell (ptCursorZIndex === -1, see ptNavigate()) is
    // reachable by keyboard/gamepad now too - drilling into it is what
    // sets ptRareMode (see ptDrillConfirm()); the shoot button also
    // doubles as its exit, mirroring the tap-anywhere-in-panel back-out
    // handleTouchStart() uses for it
    if (ptRareMode) ptRareMode = false;
    else ptDrillConfirm();
    // drilling counts as a browser interaction, same as the arrow moves
    // above - so 1 press, then Shift+drill, then a 2nd press doesn't
    // silently restart the game as an unintended "2nd consecutive" press.
    // the counter starts over from 0 instead
    gameOverShootPresses = 0;
  } else if (shootReleased) {
    // the shoot button needs a second release so a trigger-happy final shot
    // right as the game ends doesn't restart it by accident
    gameOverShootPresses++;
    if (gameOverShootPresses >= 2) {
      gameOverShootPresses = 0;
      resetGame();
      state = STATE_PLAYING;
      resetShootHoldState();
    }
  }
}

function updatePlaying(dt, gp, shootReleased, chargeAtRelease, autoFireCharged, gpLearnEdge, gpReleaseEdge) {
  timeLeft -= dt;
  if (timeLeft <= 0) {
    timeLeft = 0;
    gameOverShootPresses = 0;
    const ranks = recordRun(playerName || DEFAULT_PLAYER_NAME, score, chainMax, computeMultFactor());
    lastRunScoreRank = ranks.scoreRank;
    lastRunChainRank = ranks.chainRank;
    lastRunMultRank = ranks.multRank;
    state = STATE_GAMEOVER;
    return;
  }

  if (chainTimer > 0) {
    chainTimer -= dt;
    if (chainTimer <= 0) chainCount = 0;
  }
  if (chainPopupT > 0) chainPopupT -= dt;
  if (barrierT > 0) barrierT = Math.max(0, barrierT - dt);
  if (absorberT > 0) absorberT = Math.max(0, absorberT - dt);

  updatePlayerAndShooting(dt, gp, shootReleased, chargeAtRelease, autoFireCharged, gpLearnEdge, gpReleaseEdge);
  updateVoidCrossing(dt);
  spawnAndUpdateTargets(dt);
  updateFragments(dt);
  updateBulletPhysics(dt);
  resolveBulletTargetCollisions();
  updateItems(dt);
  updateVisualTimers(dt);
}

function updatePlayerAndShooting(dt, gp, shootReleased, chargeAtRelease, autoFireCharged, gpLearnEdge, gpReleaseEdge) {
  // player movement (keyboard + gamepad D-pad / left stick)
  let dx = 0;
  if (keys["ArrowLeft"] || keys["KeyA"]) dx -= 1;
  if (keys["ArrowRight"] || keys["KeyD"]) dx += 1;
  if (gp) {
    dx += gamepadDpadX(gp);
    const stickX = gp.axes[0] || 0;
    if (Math.abs(stickX) > GAMEPAD_STICK_DEADZONE) dx += stickX;
  }
  dx = Math.max(-1, Math.min(1, dx));
  player.x += dx * player.speed * dt;
  player.x = Math.max(FIELD_X + player.w / 2, Math.min(FIELD_RIGHT - player.w / 2, player.x));
  if (player.squashT > 0) player.squashT -= dt;

  if (player.shotCooldown > 0) player.shotCooldown -= dt * 1000;
  const learnPressed = learnQueued || gpLearnEdge || touchLearnFlick;
  learnQueued = false;
  touchLearnFlick = false;
  if (releaseQueued || touchReleaseFlick || gpReleaseEdge) {
    releaseQueued = false;
    touchReleaseFlick = false;
    releaseAbsorbedNeutrons();
  }
  if (shootReleased) shoot(false, chargeAtRelease);
  else if (autoFireCharged) shoot(false, CHARGE_MAX_DURATION);
  else if (learnPressed) shoot(true, 0);
}

function updateVoidCrossing(dt) {
  updateVoidBands(dt);

  // ship crossing the water/void boundary: surface for a breath of air on the
  // way in, dive back under with a splash on the way out. checked at the
  // ship's TOP edge (not its center) - since bubbles drift straight down onto
  // a roughly-stationary ship, the top edge is the first point they touch, so
  // this naturally fires earlier (accounting for VOID_SPEED without needing
  // an explicit lookahead) and matches where the crossing actually looks like
  // it happens on screen. the crossing bubble's center-to-player vector
  // drives which way each effect sprays
  const shipTopY = player.y - player.h / 2;
  const containingBubble = bubbleContaining(player.x, shipTopY);
  const inVoidNow = !!containingBubble;
  if (inVoidNow && !playerInVoid) {
    spawnSurfaceBreath(player.x, shipTopY, player.x - containingBubble.x, shipTopY - containingBubble.y);
  } else if (!inVoidNow && playerInVoid && playerVoidBubble) {
    spawnWaterSplash(player.x, shipTopY, player.x - playerVoidBubble.x, shipTopY - playerVoidBubble.y);
  }
  playerInVoid = inVoidNow;
  if (containingBubble) playerVoidBubble = containingBubble;
}

function spawnAndUpdateTargets(dt) {
  // spawn ①燃料(U235/U238/Pu) targets - rate and on-screen cap scale with
  // ②fuelAmount only, independent of ③b10Concentration
  spawnTimer -= dt;
  const effectiveFuelAmount = (simConfig.fuelAmount / 100) * FUEL_AMOUNT_BASE;
  const spawnInterval = Math.max(0.12, 0.55 / effectiveFuelAmount);
  const maxTargets = Math.round(Math.max(4, 26 * effectiveFuelAmount));
  // counts only fuel-type targets, not targets.length as a whole - B10 spawns
  // through its own entirely separate pipeline below with its own much higher
  // cap, so a plain targets.length check here would let a screen full of B10
  // silently block fuel from ever spawning again once B10 alone reaches
  // maxTargets, contradicting the "independent of b10Concentration" comment above
  const currentFuelCount = targets.reduce((n, t) => n + (t.type !== TYPE_B10 ? 1 : 0), 0);
  if (spawnTimer <= 0 && currentFuelCount < maxTargets) {
    spawnTarget();
    spawnTimer = spawnInterval;
  }

  // spawn ③B10 targets through an entirely separate pipeline - rate and
  // on-screen cap scale with b10Concentration only, so raising it adds
  // more B10 into the water without reducing the amount of fuel falling
  b10SpawnTimer -= dt;
  if (simConfig.b10Concentration > 0) {
    const b10Interval = Math.max(0.1, B10_SPAWN_INTERVAL_AT_MAX / simConfig.b10Concentration);
    const maxB10Targets = Math.round(B10_MAX_TARGETS_AT_MAX * simConfig.b10Concentration);
    const currentB10Count = targets.reduce((n, t) => n + (t.type === TYPE_B10 ? 1 : 0), 0);
    if (b10SpawnTimer <= 0 && currentB10Count < maxB10Targets) {
      spawnTarget(undefined, TYPE_B10);
      b10SpawnTimer = b10Interval;
    }
  }

  // update targets: fall down while wavering side to side, bouncing off the field walls
  for (const t of targets) {
    t.spawnT += dt;
    if (t.decayT !== undefined && t.decayT < DECAY_TRANSITION_DURATION) t.decayT += dt;
    t.wobbleAge += dt;
    t.vx += Math.sin(t.wobbleAge * t.wobbleFreq) * t.wobbleAccel * dt;
    t.vx = Math.max(-60, Math.min(60, t.vx));
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    const minX = FIELD_X + TARGET_RADIUS;
    const maxX = FIELD_RIGHT - TARGET_RADIUS;
    if (t.x < minX) {
      t.x = minX;
      t.vx = Math.abs(t.vx);
    } else if (t.x > maxX) {
      t.x = maxX;
      t.vx = -Math.abs(t.vx);
    }
  }
  targets = targets.filter((t) => t.y < FIELD_BOTTOM + 20);

  // 吸収体 benefit: while absorbing, the ship can also "scan" a fuel target
  // it physically touches, registering it as a discovered element (see
  // obtainedElements/the periodic-table panel) - non-destructive (the
  // target keeps falling, untouched otherwise) and once per target instance
  // (t.scanned) so lingering contact doesn't inflate the count every frame
  if (absorberT > 0) {
    for (const t of targets) {
      if (t.scanned || t.type === TYPE_B10) continue;
      const ddx = t.x - player.x, ddy = t.y - player.y;
      if (Math.abs(ddx) < player.w / 2 + TARGET_RADIUS && Math.abs(ddy) < player.h / 2 + TARGET_RADIUS) {
        t.scanned = true;
        if (t.type === TYPE_U235) recordObtainedElement(92, "U", 235);
        else if (t.type === TYPE_U238) recordObtainedElement(92, "U", 238);
        else if (t.type === TYPE_PU) {
          // still mid-way through the 238U->239Np->239Pu capture animation
          // (see DECAY_TRANSITION_DURATION) - register the intermediate Np,
          // not the Pu its `type` has already settled to
          if (t.decayT !== undefined && t.decayT < DECAY_TRANSITION_DURATION) recordObtainedElement(93, "Np", 239);
          else recordObtainedElement(94, "Pu", 239);
        }
      }
    }
  }
}

function updateBulletPhysics(dt) {
  // chain-highlight glow: purely derived each frame from which surviving
  // neutron(s) currently have the highest gen - no per-fission bookkeeping
  // needed. Only lights up once that max reaches CHAIN_AURA_MIN_GEN; below
  // that, nothing glows. auraGlowT ramps up quickly on whichever bullet(s)
  // are currently the leader and decays slowly on every other bullet, so
  // losing the lead (reacting, exiting the field, getting absorbed, or a
  // deeper neutron taking over) fades out gently instead of snapping off
  let maxSurvivingGen = -Infinity;
  for (const b of bullets) if (b.gen > maxSurvivingGen) maxSurvivingGen = b.gen;
  for (const b of bullets) {
    const isLeader = maxSurvivingGen >= CHAIN_AURA_MIN_GEN && b.gen === maxSurvivingGen;
    b.auraGlowT = isLeader
      ? Math.min(1, (b.auraGlowT || 0) + dt * CHAIN_AURA_RAMP_UP_RATE)
      : Math.max(0, (b.auraGlowT || 0) - dt * CHAIN_AURA_DECAY_RATE);
  }

  // update bullets: neutrons slow down the further they travel through water
  // (moderation), down to a minimum "thermalized" speed floor; voids don't
  // moderate at all, so a neutron currently inside one keeps its speed
  for (const b of bullets) {
    const speed = Math.hypot(b.vx, b.vy);
    const inVoidNow = isInVoid(b.x, b.y);
    // learning-shot-only teaching moment - unlike every other learning
    // message (which can repeat indefinitely), this one is capped at once
    // per run (see voidSpeedLessonShown/resetGame()): a learning shot can
    // cross in and out of a void many times in a single play session, and
    // repeating the same line each time would crowd out every other lesson
    if (b.learning && inVoidNow && !b.inVoid && !voidSpeedLessonShown) {
      logNuclearEvent("気泡内では中性子の速さは遅くならない");
      voidSpeedLessonShown = true;
    }
    b.inVoid = inVoidNow;
    if (speed > 0 && !inVoidNow) {
      b.distTraveled += speed * dt;
      const newSpeed =
        NEUTRON_MIN_SPEED + (b.speed0 - NEUTRON_MIN_SPEED) * Math.exp(-b.distTraveled / NEUTRON_DECAY_LENGTH);
      const scale = newSpeed / speed;
      b.vx *= scale;
      b.vy *= scale;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // 反射体 barrier: neutrons reaching the field edges scatter back inward
    // instead of leaking off-screen
    if (barrierT > 0) {
      if (b.x < FIELD_X) { b.x = FIELD_X; scatterBullet(b); }
      else if (b.x > FIELD_RIGHT) { b.x = FIELD_RIGHT; scatterBullet(b); }
      if (b.y < FIELD_Y) { b.y = FIELD_Y; scatterBullet(b); }
      else if (b.y > FIELD_BOTTOM) { b.y = FIELD_BOTTOM; scatterBullet(b); }
    }
    // ship-as-paddle: a neutron falling onto the ship (moving downward, vy > 0)
    // bounces back upward instead of passing through - only downward-moving
    // neutrons qualify, so the ship's own freshly-fired (upward) shots don't
    // immediately re-trigger this at their spawn point right above the ship
    if (b.vy > 0) {
      const ddx = b.x - player.x, ddy = b.y - player.y;
      if (Math.abs(ddx) < player.w / 2 + 6 && Math.abs(ddy) < player.h / 2 + 6) {
        // 吸収体 active: the ship absorbs the neutron instead of bouncing it
        // (see drawPlayer()'s black tint for the same state) - marked here,
        // actually removed from `bullets` by the filter just below
        if (absorberT > 0) {
          spawnAbsorptionPoof(b.x, b.y);
          b.absorbed = true;
          // tallied by generation, not just counted - see releaseAbsorbedNeutrons()
          absorbedNeutronsByGen[b.gen] = (absorbedNeutronsByGen[b.gen] || 0) + 1;
        } else {
          paddleBounceBullet(b, player);
        }
      }
    }
  }
  bullets = bullets.filter(
    (b) => !b.absorbed && b.x > FIELD_X - 20 && b.x < FIELD_RIGHT + 20 && b.y > FIELD_Y - 20 && b.y < FIELD_BOTTOM + 20
  );
}

// fission (U235/Pu): the target splits into two tracked fragments plus a
// burst of new neutrons, and pays the full gen-scaled score
function handleFissionHit(hit, b, bulletSpeed, hitLabel) {
  targets.splice(targets.indexOf(hit), 1);
  spawnExplosion(hit.x, hit.y, true);
  // which yield table (thermal/500keV/14MeV) gets sampled depends on how
  // fast THIS neutron still is when it reacts - see fissionTableFor()
  const fissionTable = fissionTableFor(hit.type, bulletSpeed);
  const n = sampleNeutronYield(fissionTable.neutronDist);
  spawnFissionNeutrons(hit.x, hit.y, b.gen, n);
  const products = pickFissionProducts(fissionTable, n);
  fissionHistory.push({ x: hit.x, y: hit.y, neutronCount: n, products });
  if (fissionHistory.length > 50) fissionHistory.shift();
  const showLabels = floatingLabelCooldown <= 0;
  if (showLabels) floatingLabelCooldown = FLOATING_LABEL_MIN_GAP;
  recordFissionProductBin(products[0].A, products[0].symbol, showLabels);
  recordFissionProductBin(products[1].A, products[1].symbol, showLabels);
  recordObtainedElement(products[0].Z, products[0].symbol, products[0].A);
  recordObtainedElement(products[1].Z, products[1].symbol, products[1].A);
  // both fragments are neutron-rich and unstable, so they linger in the
  // field and visibly walk their real decay chain (see spawnFragment()).
  // spawned a few px apart on opposite sides of the hit point (rather
  // than both at the exact same pixel) - loosely momentum-conservation-
  // flavored, like the two fragments recoiling apart from the split -
  // so they read as two distinct particles from the very first frame
  // instead of overlapping until their (independently random) outward
  // velocities happen to carry them apart
  const fragAxis = Math.random() * Math.PI * 2;
  const fragOffset = 3 + Math.random() * 3;
  const fragOx = Math.cos(fragAxis) * fragOffset, fragOy = Math.sin(fragAxis) * fragOffset;
  spawnFragment(hit.x + fragOx, hit.y + fragOy, products[0].Z, products[0].A, b.gen + 1);
  spawnFragment(hit.x - fragOx, hit.y - fragOy, products[1].Z, products[1].A, b.gen + 1);
  const gain = awardNeutronScore(GEN_SCORE_BASE, b.gen);
  score += gain;
  registerChain(b.gen);
  maybeSpawnItem(hit.x, hit.y);
  if (b.learning) {
    logNuclearEvent(
      `核分裂発生！ ${hitLabel}が分裂→${isotopeHTML(products[0].A, products[0].symbol)}+${isotopeHTML(products[1].A, products[1].symbol)}+中性子${n === 0 ? "ゼロ" : n + "個"}`
    );
  }
}

// U238 capture: the target itself survives (mid-transition to Pu), no
// fragments/new neutrons - just a smaller flat score
function handleU238CaptureHit(hit, b, hitLabel) {
  hit.type = TYPE_PU;
  hit.decayT = 0; // shows the intermediate 239U→239Np look before settling into Pu
  spawnExplosion(hit.x, hit.y, false);
  score += awardNeutronScore(CAPTURE_U238_SCORE_BASE, b.gen);
  if (b.learning) {
    logNuclearEvent(`中性子捕獲！ ${hitLabel}が中性子を吸収してPuに変身中`);
  }
}

// B10 capture: the target is consumed and emits an alpha (B10(n,alpha)Li7) -
// no fission, so no fragments/new neutrons either, just the smallest flat score
function handleB10CaptureHit(hit, b, hitLabel) {
  targets.splice(targets.indexOf(hit), 1);
  // no spawnExplosion() here - B10 just absorbs the neutron and emits an
  // alpha, it doesn't fission, so it shouldn't get the same yellow burst
  // as an actual fission event. B10(n,alpha)Li7: the same real reaction
  // the log line already describes ("α線を放出した") - reuses
  // spawnDecayTrail()'s alpha-track visual (mode "A" in DECAY_MODE_EFFECT
  // is a plain alpha emission) so this reaction's alpha ray reads exactly
  // like an in-chain alpha decay
  spawnDecayTrail(hit.x, hit.y, "A");
  score += awardNeutronScore(CAPTURE_B10_SCORE_BASE, b.gen);
  if (b.learning) {
    logNuclearEvent(`中性子吸収！ ${hitLabel}が中性子を吸収してα線を放出した`);
  }
}

function resolveBulletTargetCollisions() {
  const survivingBullets = [];
  for (const b of bullets) {
    let hit = null;
    for (const t of targets) {
      const ddx = b.x - t.x, ddy = b.y - t.y;
      if (ddx * ddx + ddy * ddy < TARGET_RADIUS * TARGET_RADIUS) {
        hit = t;
        break;
      }
    }
    if (!hit) {
      survivingBullets.push(b);
      continue;
    }

    // reaction likelihood depends on how much this neutron has slowed down -
    // a still-fast neutron usually just scatters (bounces off in a new
    // direction) instead of reacting
    const bulletSpeed = Math.hypot(b.vx, b.vy);
    const hitLabel =
      hit.type === TYPE_U235 ? isotopeHTML(235, "U") :
      hit.type === TYPE_PU ? "Pu" :
      hit.type === TYPE_U238 ? isotopeHTML(238, "U") :
      isotopeHTML(10, "B");
    if (hit.type === TYPE_U235 || hit.type === TYPE_PU || hit.type === TYPE_B10) {
      const prob = reactionProbability(bulletSpeed, FAST_REACTION_CHANCE_FISSION);
      if (!b.guaranteedReaction && Math.random() >= prob) {
        scatterBullet(b);
        survivingBullets.push(b);
        if (b.learning) {
          const verb = hit.type === TYPE_B10 ? "吸収されにくい" : "核分裂を起こしにくい";
          logNuclearEvent(`${hitLabel}で中性子が散乱：速い中性子は${verb}`);
        }
        continue;
      }
    } else if (hit.type === TYPE_U238) {
      const prob = reactionProbability(bulletSpeed, FAST_REACTION_CHANCE_CAPTURE238);
      if (!b.guaranteedReaction && Math.random() >= prob) {
        scatterBullet(b);
        survivingBullets.push(b);
        if (b.learning) {
          logNuclearEvent(`${hitLabel}で中性子が散乱：速い中性子は捕獲されにくい`);
        }
        continue;
      }
    }

    if (hit.type === TYPE_U235 || hit.type === TYPE_PU) {
      handleFissionHit(hit, b, bulletSpeed, hitLabel);
    } else if (hit.type === TYPE_U238) {
      handleU238CaptureHit(hit, b, hitLabel);
    } else if (hit.type === TYPE_B10) {
      handleB10CaptureHit(hit, b, hitLabel);
    }
    // bullet is consumed regardless of target type
  }
  bullets = survivingBullets;
}

function updateItems(dt) {
  for (const it of items) {
    it.y += it.vy * dt;
    it.spin += dt * 3;
  }
  items = items.filter((it) => it.y < FIELD_BOTTOM + 20);

  // player vs item pickup
  items = items.filter((it) => {
    const ddx = it.x - player.x, ddy = it.y - player.y;
    if (Math.abs(ddx) < player.w / 2 + 8 && Math.abs(ddy) < player.h / 2 + 8) {
      if (it.type === ITEM_TYPE_REFLECTOR) {
        // only starts a fresh barrier if one isn't already up - picking up a
        // second one mid-barrier doesn't stack or extend the duration
        if (barrierT <= 0) barrierT = BARRIER_DURATION;
        absorberChance = Math.min(ABSORBER_CHANCE_MAX, absorberChance + ABSORBER_CHANCE_STEP);
        // lifts the 吸収体 curse early, on top of its normal effects above -
        // otherwise absorberT just keeps counting down to 0 on its own.
        // the absorbedNeutronsByGen stash is a persistent bank (see its own
        // comment) so it's untouched here - only a full run reset clears it
        absorberT = 0;
        score += 1;
        return false;
      }
      if (it.type === ITEM_TYPE_ABSORBER) {
        if (absorberT <= 0) absorberT = ABSORBER_DURATION;
        absorberChance = 0; // back to needing 反射体 pickups to climb again
        score += 1;
        return false;
      }
      if (power >= 100) player.triWayT = TRI_WAY_DURATION; // already maxed - grant a brief 3-way shot instead
      // while a 3-way burst is already running, a star only refills at half
      // strength - between this and the continuous drain below, power keeps
      // trending down through the whole burst even if the player chains
      // several stars back-to-back, instead of just sitting pinned at 100
      // (which used to also silently re-trigger a fresh full-length burst
      // for free every time - see player.triWayT's countdown just below)
      power = Math.min(100, power + (player.triWayT > 0 ? 15 / 2 : 15));
      score += 1;
      return false;
    }
    return true;
  });
  if (player.triWayT > 0) {
    // drains continuously over the burst (TRI_WAY_POWER_COST total by the
    // time a full-length burst ends) rather than as one lump sum at expiry -
    // that way the cost is already being paid throughout the burst, so
    // chaining star pickups to keep it alive longer doesn't dodge it the
    // way a pay-at-expiry version would (see the halved star gain above)
    power = Math.max(0, power - (TRI_WAY_POWER_COST / TRI_WAY_DURATION) * dt);
    player.triWayT -= dt;
  }
}

function updateVisualTimers(dt) {
  // update explosions
  for (const ex of explosions) ex.t += dt;
  explosions = explosions.filter((ex) => ex.t < ex.dur);

  // update juice particles (drag so they decelerate into a satisfying pop)
  for (const p of particles) {
    p.t += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92;
    p.vy *= 0.92;
  }
  particles = particles.filter((p) => p.t < p.dur);

  // update floating isotope labels (drift upward, fade out)
  if (floatingLabelCooldown > 0) floatingLabelCooldown -= dt;
  for (const fl of floatingLabels) {
    fl.t += dt;
    fl.y -= 22 * dt;
  }
  floatingLabels = floatingLabels.filter((fl) => fl.t < fl.dur);
}

// ---- rendering ----
function drawBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, GAME_H);
  grad.addColorStop(0, COLORS.skyTop);
  grad.addColorStop(1, COLORS.skyBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, GAME_W, GAME_H);

  // rounded "water window" frame around the playfield
  roundRectPath(FIELD_X - 6, FIELD_Y - 6, FIELD_W + 12, FIELD_H + 12, 20);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  roundRectPath(FIELD_X - 2, FIELD_Y - 2, FIELD_W + 4, FIELD_H + 4, 16);
  // deep-to-shallow water gradient gives the water body some sense of density/depth
  const waterGrad = ctx.createLinearGradient(0, FIELD_Y, 0, FIELD_BOTTOM);
  waterGrad.addColorStop(0, "#154272");
  waterGrad.addColorStop(1, "#051d38");
  ctx.fillStyle = waterGrad;
  ctx.fill();
}

// sparse distant twinkle (kept subtle - light glinting deep in the water)
const STAR_SEED = Array.from({ length: 30 }, () => ({
  fx: Math.random(), fy: Math.random(),
  r: 0.5 + Math.random() * 1.1,
  tw: Math.random() * Math.PI * 2,
}));

// dense drifting motes (suspended particles/plankton) - these make the water read
// as "full of stuff", the opposite of the emptied-out void bubbles
const WATER_PARTICLE_SEED = Array.from({ length: 90 }, () => ({
  fx: Math.random(), fy: Math.random(),
  r: 0.6 + Math.random() * 1.3,
  driftAmp: 4 + Math.random() * 8,
  phase: Math.random() * Math.PI * 2,
  speedMul: 0.5 + Math.random() * 0.6,
}));

function drawField() {
  ctx.save();
  ctx.beginPath();
  ctx.rect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H);
  ctx.clip();
  const t = fieldScrollY * 0.03;

  for (const s of STAR_SEED) {
    const y = FIELD_Y + ((s.fy * FIELD_H + fieldScrollY) % FIELD_H);
    const x = FIELD_X + s.fx * FIELD_W;
    const twinkle = 0.5 + 0.5 * Math.sin(t * 4 + s.tw);
    ctx.globalAlpha = 0.2 + twinkle * 0.3;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const p of WATER_PARTICLE_SEED) {
    const y = FIELD_Y + ((p.fy * FIELD_H + fieldScrollY * p.speedMul) % FIELD_H);
    const wobble = Math.sin(t * 2 + p.phase) * p.driftAmp;
    const x = FIELD_X + ((p.fx * FIELD_W + wobble + FIELD_W) % FIELD_W);
    ctx.globalAlpha = 0.35 + 0.25 * Math.sin(t * 3 + p.phase);
    ctx.fillStyle = "rgba(170,220,255,0.9)";
    ctx.beginPath();
    ctx.arc(x, y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

// glowing blue frame around the playfield while a 反射体 (reflector) is
// active; flashes in its last couple of seconds as a warning it's expiring
function drawBarrier() {
  if (barrierT <= 0) return;
  const pulse = 0.5 + 0.5 * Math.sin(fieldScrollY * 0.15);
  const fading = barrierT < 2;
  const alpha = fading ? Math.max(0.2, (Math.sin(barrierT * 12) + 1) / 2) : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = `rgba(79, 195, 255, ${0.6 + pulse * 0.35})`;
  ctx.lineWidth = 7;
  ctx.shadowColor = "rgba(79, 195, 255, 0.9)";
  ctx.shadowBlur = 16;
  ctx.strokeRect(FIELD_X + 3.5, FIELD_Y + 3.5, FIELD_W - 7, FIELD_H - 7);
  ctx.restore();
}

// glassy "void (bubble)" circles drifting through the water - reactions
// become rare for neutrons that hit a nucleus while inside one of these
// one bubble's glassy circle, drawn at an arbitrary (x,y) - factored out of
// drawVoidBands() so the same look can be stamped a second time at a
// bubble's wrapped position (see voidWrapX()) without duplicating it
function drawVoidBubbleAt(x, y, r) {
  // translucent glassy interior (like a real bubble you can half-see-through),
  // with a bright crisp rim and glare doing the heavy lifting to read as "empty"
  const grad = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, r * 0.1, x, y, r);
  grad.addColorStop(0, "rgba(255,255,255,0.5)");
  grad.addColorStop(0.6, "rgba(220,240,255,0.24)");
  grad.addColorStop(1, "rgba(220,240,255,0.1)");
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  // bright crisp rim: the air/water surface-tension boundary
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.stroke();
  // strong glare highlight - the clearest "this is glass/air, not water" cue
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fill();
}

function drawVoidBands() {
  ctx.save();
  ctx.beginPath();
  ctx.rect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H);
  ctx.clip();
  for (const bubble of voidBands) {
    drawVoidBubbleAt(bubble.x, bubble.y, bubble.r);
    // overflowing past a side wall - its wrapped twin on the opposite wall
    // (see voidWrapX()) needs its own stamp, otherwise the sliver that
    // reappears there for isInVoid()'s purposes would be invisible
    const wrapX = voidWrapX(bubble);
    if (wrapX !== null) drawVoidBubbleAt(wrapX, bubble.y, bubble.r);
  }
  ctx.restore();
}

// role-based expression: fissile nuclides look pouty/prickly (they react the
// instant a neutron touches them), the parent nuclide looks calm (it only
// transforms, it never fissions), and the neutron absorber looks stern/blocking
// 238U + n really becomes 239U, which beta-decays to 239Np and then to 239Pu -
// shown here as one held "in-between" look right after capture before settling
// into the normal Pu appearance
const DECAY_TRANSITION_DURATION = 0.5;
const DECAY_INTERMEDIATE_COLOR = "#3ecfa8";

function expressionForType(type) {
  if (type === TYPE_U235 || type === TYPE_PU) return "pouty";
  if (type === TYPE_U238) return "calm";
  return "stoic"; // TYPE_B10
}

function drawEyes(cx, cy, radius, expression) {
  const eyeOffsetX = radius * 0.32, eyeOffsetY = -radius * 0.05, eyeR = radius * 0.16;
  for (const side of [-1, 1]) {
    const ex = cx + side * eyeOffsetX, ey = cy + eyeOffsetY;
    if (expression === "pouty") {
      // furrowed angry eyebrow, slanting down toward the center (プンプン)
      ctx.beginPath();
      ctx.moveTo(ex + side * eyeR * 1.2, ey - eyeR * 1.8);
      ctx.lineTo(ex - side * eyeR * 0.6, ey - eyeR * 1.0);
      ctx.strokeStyle = "#2a2440";
      ctx.lineWidth = Math.max(1, radius * 0.09);
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = "#2a2440";
      ctx.fill();
    } else if (expression === "calm") {
      ctx.beginPath();
      ctx.arc(ex, ey + eyeR * 0.3, eyeR * 0.9, Math.PI, 2 * Math.PI);
      ctx.strokeStyle = "#2a2440";
      ctx.lineWidth = Math.max(1, radius * 0.07);
      ctx.lineCap = "round";
      ctx.stroke();
    } else if (expression === "transforming") {
      // plain neutral dot eyes, no brow - "not sure what it is yet" look,
      // used mid-way through the 239U -> 239Np -> 239Pu beta-decay animation
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR * 0.85, 0, Math.PI * 2);
      ctx.fillStyle = "#2a2440";
      ctx.fill();
    } else if (expression === "poison") {
      // droopy half-lidded eye - a poison nuclide (see drawFragments()) reads
      // as sluggish/inert while it sits there waiting to absorb a neutron
      ctx.beginPath();
      ctx.moveTo(ex + side * eyeR * 0.8, ey - eyeR * 1.0);
      ctx.lineTo(ex - side * eyeR * 0.8, ey - eyeR * 0.2);
      ctx.strokeStyle = "#2a2440";
      ctx.lineWidth = Math.max(1, radius * 0.09);
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ex, ey + eyeR * 0.3, eyeR * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = "#2a2440";
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(ex - eyeR * 0.9, ey);
      ctx.lineTo(ex + eyeR * 0.9, ey);
      ctx.strokeStyle = "#2a2440";
      ctx.lineWidth = Math.max(1, radius * 0.09);
      ctx.lineCap = "round";
      ctx.stroke();
    }
  }
}

function drawMouth(cx, cy, radius, expression) {
  ctx.strokeStyle = "#2a2440";
  ctx.lineCap = "round";
  if (expression === "pouty") {
    // small puckered, muttering mouth
    ctx.beginPath();
    ctx.moveTo(cx - radius * 0.16, cy + radius * 0.34);
    ctx.quadraticCurveTo(cx - radius * 0.06, cy + radius * 0.24, cx, cy + radius * 0.32);
    ctx.quadraticCurveTo(cx + radius * 0.06, cy + radius * 0.24, cx + radius * 0.16, cy + radius * 0.34);
    ctx.lineWidth = Math.max(1, radius * 0.08);
    ctx.stroke();
  } else if (expression === "calm") {
    ctx.beginPath();
    ctx.arc(cx, cy + radius * 0.15, radius * 0.22, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.lineWidth = Math.max(1, radius * 0.08);
    ctx.stroke();
  } else if (expression === "transforming") {
    // flat, neutral mouth - neither the calm smile nor the pouty grit
    ctx.beginPath();
    ctx.moveTo(cx - radius * 0.16, cy + radius * 0.32);
    ctx.lineTo(cx + radius * 0.16, cy + radius * 0.32);
    ctx.lineWidth = Math.max(1, radius * 0.08);
    ctx.stroke();
  } else if (expression === "poison") {
    // open mouth with a small lolling tongue (ペロリ) - the "hungrily
    // waiting to swallow a neutron" look
    ctx.beginPath();
    ctx.arc(cx, cy + radius * 0.18, radius * 0.22, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.lineWidth = Math.max(1, radius * 0.08);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + radius * 0.08, cy + radius * 0.28, radius * 0.12, 0, Math.PI);
    ctx.fillStyle = "#ff6b81";
    ctx.fill();
    ctx.strokeStyle = "#2a2440";
    ctx.lineWidth = Math.max(1, radius * 0.06);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - radius * 0.18, cy + radius * 0.32);
    ctx.lineTo(cx + radius * 0.18, cy + radius * 0.32);
    ctx.lineWidth = Math.max(1, radius * 0.09);
    ctx.stroke();
  }
}

function drawChibiFace(cx, cy, radius, color, expression) {
  const grad = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.35, radius * 0.15, cx, cy, radius);
  grad.addColorStop(0, lighten(color, 0.4));
  grad.addColorStop(1, color);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.stroke();

  drawEyes(cx, cy, radius, expression);

  // pouty cheeks are puffed out (プンプン) - bigger and rosier than the normal blush
  const puffed = expression === "pouty";
  ctx.fillStyle = puffed ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.35)";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      cx + side * radius * (puffed ? 0.6 : 0.55), cy + radius * 0.25,
      radius * (puffed ? 0.26 : 0.18), radius * (puffed ? 0.17 : 0.11),
      0, 0, Math.PI * 2
    );
    ctx.fill();
  }

  drawMouth(cx, cy, radius, expression);

  if (expression === "stoic") {
    // small shield mark: this one blocks neutrons instead of reacting to them
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius * 0.78);
    ctx.lineTo(cx - radius * 0.16, cy - radius * 0.62);
    ctx.lineTo(cx - radius * 0.16, cy - radius * 0.46);
    ctx.lineTo(cx, cy - radius * 0.32);
    ctx.lineTo(cx + radius * 0.16, cy - radius * 0.46);
    ctx.lineTo(cx + radius * 0.16, cy - radius * 0.62);
    ctx.closePath();
    ctx.fill();
  }
}

function drawTargets() {
  for (const t of targets) {
    const pop = easeOutBack(Math.min(1, t.spawnT / 0.25));
    if (pop <= 0.02) continue;
    const bob = Math.sin(t.wobbleAge * 3) * 1.5;
    let color = TYPE_COLORS[t.type];
    let expression = expressionForType(t.type);
    if (t.decayT !== undefined && t.decayT < DECAY_TRANSITION_DURATION) {
      color = DECAY_INTERMEDIATE_COLOR;
      expression = "transforming";
    }
    drawChibiFace(t.x, t.y + bob, TARGET_RADIUS * pop, color, expression);
  }
}

// only poison nuclides (see updateFragments()) ever get drawn here - every
// other fragment stays invisible (just its emitted radiation flashes, see
// spawnDecayTrail()/spawnEMWave()) so the field doesn't get cluttered with a
// circle+label per fission fragment. A poison nuclide lingers and actually
// competes with the player for neutrons, so it needs to be visible.
function drawFragments() {
  for (const f of fragments) {
    if (!f.isPoison) continue;
    const pop = easeOutBack(Math.min(1, (f.poisonSpawnT || 0) / 0.18));
    if (pop <= 0.02) continue;
    // independent of updateFragments()'s horizontal wobble above (a
    // different rate, and phased by each fragment's own x rather than
    // sharing wobbleAge) so the two axes don't move in lockstep
    const bob = Math.sin(performance.now() * 0.006 + f.x) * 1.5;
    drawChibiFace(f.x, f.y + bob, TARGET_RADIUS * pop, POISON_COLOR, "poison");
  }
}

function drawBullets() {
  for (const b of bullets) {
    // gen 1 = fired by the player (pale sky blue); gen >= 2 = born from
    // fission (pale emerald green); a learning shot (either gen) is instead
    // pale sakura pink, so it's obvious which neutron will explain itself.
    // a delayed neutron (b.white - ejected by a decaying fission fragment,
    // see updateFragments()) moves and collides exactly like any other
    // neutron, just rendered pure white so it reads as physically distinct
    // from a prompt fission neutron even though both are gen >= 2
    const fromPlayer = b.gen === 1;
    // 吸収体 release burst (b.released, see releaseAbsorbedNeutrons()): a
    // void-purple glow distinct from every other neutron color, growing
    // slightly with generation so the highest-gen (fastest, most valuable)
    // shots in the burst also read as visually biggest
    const outerR = b.released ? 8 + Math.min(4, (b.gen - 1) * 0.6) : 7;
    const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, outerR);
    if (b.released) {
      grad.addColorStop(0, "#f3e6ff");
      grad.addColorStop(0.5, "#8b3a9e");
      grad.addColorStop(1, "rgba(139,58,158,0)");
    } else if (b.white) {
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(0.5, "#f2f4fa");
      grad.addColorStop(1, "rgba(242,244,250,0)");
    } else if (b.learning) {
      grad.addColorStop(0, "#fff0f5");
      grad.addColorStop(0.5, "#f7a8c4");
      grad.addColorStop(1, "rgba(247,168,196,0)");
    } else if (fromPlayer) {
      grad.addColorStop(0, "#eafbff");
      grad.addColorStop(0.5, "#6fc9ee");
      grad.addColorStop(1, "rgba(111,201,238,0)");
    } else {
      grad.addColorStop(0, "#e8fff5");
      grad.addColorStop(0.5, "#3ddfab");
      grad.addColorStop(1, "rgba(61,223,171,0)");
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(b.x, b.y, outerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = b.released ? "#fdf6ff" : b.white ? "#ffffff" : b.learning ? "#fff5f8" : fromPlayer ? "#f2fcff" : "#eefff8";
    ctx.beginPath();
    ctx.arc(b.x, b.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
    // chain-highlight aura (see updateBulletPhysics()'s per-frame auraGlowT pass):
    // singles out whichever surviving neutron(s) currently have the deepest
    // generation, once that depth reaches CHAIN_AURA_MIN_GEN. Always gold
    // rather than matching the popup's own (white/gold/Cherenkov-blue) tier
    // color - gold reads consistently against every bullet color and the
    // dark field background, where white in particular would be harder to
    // tell apart from the white delayed-neutron bullets and pale bullet cores
    if (b.auraGlowT > 0) {
      // a soft radial glow (gold fading to fully transparent) rather than a
      // flat-color ring - reads as a halo/aura instead of a hard outline,
      // and stays more translucent overall so it doesn't compete with the
      // bullet's own color underneath. auraGlowT itself already carries the
      // ramp-up/decay animation (see updateBulletPhysics()), so alpha here is just a
      // straight scale of it
      ctx.save();
      ctx.globalAlpha = 0.55 * b.auraGlowT;
      const auraR = outerR + 6;
      const auraGrad = ctx.createRadialGradient(b.x, b.y, outerR * 0.4, b.x, b.y, auraR);
      auraGrad.addColorStop(0, "rgba(255, 210, 63, 0.6)");
      auraGrad.addColorStop(0.65, "rgba(255, 210, 63, 0.28)");
      auraGrad.addColorStop(1, "rgba(255, 210, 63, 0)");
      ctx.fillStyle = auraGrad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, auraR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawStar(cx, cy, outerR, innerR, points, rotation, fill) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = rotation + (Math.PI / points) * i;
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

// diamond tumbling end-over-end (simulated depth rotation via a horizontal
// squash that cycles through zero, like a coin flipping in 3D) - a distinct
// blue silhouette so it reads as different from the yellow power star at a glance
function drawReflectorItem(cx, cy, spin) {
  const depthScale = Math.cos(spin);
  const facingViewer = depthScale >= 0;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(Math.max(0.12, Math.abs(depthScale)), 1);
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(6, 0);
  ctx.lineTo(0, 8);
  ctx.lineTo(-6, 0);
  ctx.closePath();
  ctx.fillStyle = facingViewer ? "#4fc3ff" : "#1c6fb0";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

// dark disk with an inward-winding spiral, spinning in place like a
// whirlpool/drain rather than tumbling in 3D the way the reflector diamond
// does - absorbing has no "two-sided" state to show (unlike the reflector's
// flip between faces), so a plain rotation reads as "being pulled in" far
// more directly than a coin-flip squash would on a spiral shape. white
// spiral + outline keep it legible against the pale field background
function drawAbsorberItem(cx, cy, spin) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(spin);

  const r = 8;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = "#1f1f1f";
  ctx.fill();

  ctx.beginPath();
  const turns = 1.6, steps = 20;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = t * turns * Math.PI * 2;
    const rad = r * 0.82 * (1 - t);
    const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 1.2;
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.restore();
}

function drawItems() {
  for (const it of items) {
    if (it.type === ITEM_TYPE_REFLECTOR) {
      drawReflectorItem(it.x, it.y, it.spin);
    } else if (it.type === ITEM_TYPE_ABSORBER) {
      drawAbsorberItem(it.x, it.y, it.spin);
    } else {
      drawStar(it.x, it.y, 9, 4, 5, it.spin, "#ffd23f");
    }
  }
}

function drawExplosions() {
  for (const ex of explosions) {
    const p = ex.t / ex.dur;
    // slightly smaller/dimmer than a full-alpha flash for the "big" (actual
    // fission) case specifically - during a fast chain reaction these can
    // spawn several times a second, all across the field, so a softer peak
    // keeps that moment readable without turning into a rapid-strobe wall
    // of full-brightness flashes. the smaller "big:false" case (e.g. a lone
    // U238 capture) isn't part of that same rapid-fire pattern, so it's left
    // at its original full brightness/size
    const size = (ex.big ? 42 : 28) * (0.5 + p * 0.9);
    const peakAlpha = ex.big ? 0.7 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, peakAlpha * (1 - p));
    const grad = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, size / 2);
    grad.addColorStop(0, "#fff6d0");
    grad.addColorStop(0.4, ex.big ? "#ffb347" : "#ffe066");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ex.x, ex.y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawParticles() {
  for (const p of particles) {
    const alpha = Math.max(0, 1 - p.t / p.dur);
    ctx.globalAlpha = alpha;
    // radiation track (see spawnDecayTrail()): a short streak trailing behind
    // the particle's current travel direction instead of a plain dot, so
    // alpha (thick/short) and beta (thin/long) read as distinct at a glance.
    // Styled after real cloud-chamber photos: a linear gradient fades the
    // stroke from solid at the origin end to transparent at the tip (real
    // tracks read as denser near where the ionizing particle actually is,
    // trailing off toward the fog's older/dispersing edge).
    if (p.trail) {
      const speed = Math.hypot(p.vx, p.vy);
      const backAngle = speed > 1 ? Math.atan2(p.vy, p.vx) + Math.PI : Math.PI;
      const tailX = p.x + Math.cos(backAngle) * p.len;
      const tailY = p.y + Math.sin(backAngle) * p.len;
      const grad = ctx.createLinearGradient(p.x, p.y, tailX, tailY);
      grad.addColorStop(0, rgbaFromHex(p.color, 0.95));
      grad.addColorStop(1, rgbaFromHex(p.color, 0));
      ctx.strokeStyle = grad;
      ctx.lineWidth = p.width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
      continue;
    }
    // electromagnetic radiation (gamma/X-ray - see spawnAnnihilationEvent(),
    // spawnCharacteristicXray(), and the IT branch of spawnDecayTrail()):
    // unlike a charged particle's straight track (stopped quickly by
    // matter), this reads as a fast, highly penetrating "wipe" - the ray
    // shoots out to its full length almost instantly (0.18s: growFrac),
    // holds there, then gets erased from the origin end over the back 60%
    // of its lifetime (tailFrac) - so what's on screen is only ever the gap
    // between the (fast-growing) head and the (slower-following) tail,
    // never the whole length at once. Drawn as a sine curve oscillating
    // perpendicular to the direction of travel, with its own alpha
    // envelope (peaks mid-lifetime) layered under drawParticles()'s usual
    // per-particle 1-t/dur fade (ctx.globalAlpha, set above).
    if (p.wave) {
      const angle = Math.atan2(p.vy, p.vx);
      const maxLen = p.len;
      const lifeFrac = p.dur > 0 ? p.t / p.dur : 1;
      const growFrac = Math.min(1, p.t / 0.18);
      const tailFrac = lifeFrac > 0.4 ? (lifeFrac - 0.4) / 0.6 : 0;
      const headDist = maxLen * growFrac;
      const tailDist = maxLen * tailFrac;
      const visibleLen = Math.max(0, headDist - tailDist);
      if (visibleLen <= 1) continue;

      const headX = p.x + Math.cos(angle) * headDist, headY = p.y + Math.sin(angle) * headDist;
      const tailX = p.x + Math.cos(angle) * tailDist, tailY = p.y + Math.sin(angle) * tailDist;

      const waveAlpha = Math.min(1, Math.sin(lifeFrac * Math.PI) * 1.8);
      const grad = ctx.createLinearGradient(headX, headY, tailX, tailY);
      grad.addColorStop(0, rgbaFromHex(p.color, 1.0 * waveAlpha));
      grad.addColorStop(0.3, rgbaFromHex(p.color, 0.8 * waveAlpha));
      grad.addColorStop(1, rgbaFromHex(p.color, 0));

      ctx.save();
      ctx.strokeStyle = grad;
      ctx.lineWidth = 0.6;
      ctx.lineCap = "round";
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 2;

      const perpX = -Math.sin(angle), perpY = Math.cos(angle);
      const segments = Math.max(16, Math.floor(visibleLen / 3));
      ctx.beginPath();
      for (let i = 0; i <= segments; i++) {
        const frac = i / segments;
        const distFromStart = tailDist + (headDist - tailDist) * (1 - frac);
        const alongX = headX + (tailX - headX) * frac, alongY = headY + (tailY - headY) * frac;
        const envelope = Math.sin(frac * Math.PI);
        const offset = Math.sin((distFromStart / maxLen) * p.waveCycles * Math.PI * 2) * p.amplitude * envelope;
        const px = alongX + perpX * offset, py = alongY + perpY * offset;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
      continue;
    }
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  const p = player;
  const squash = p.squashT > 0 ? p.squashT / 0.12 : 0;
  const sx = 1 + squash * 0.18, sy = 1 - squash * 0.18;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(sx, sy);

  const flameLen = 8 + Math.sin(fieldScrollY * 0.3) * 2;
  ctx.beginPath();
  ctx.moveTo(-6, p.h / 2 - 4);
  ctx.lineTo(0, p.h / 2 - 4 + flameLen);
  ctx.lineTo(6, p.h / 2 - 4);
  ctx.closePath();
  ctx.fillStyle = "#ffb347";
  ctx.fill();

  if (isChargingShoot && shootChargeT > 0.2) {
    // charge glow above the nose, growing as the shot charges up
    const frac = Math.min(1, shootChargeT / CHARGE_MAX_DURATION);
    const glowR = 10 + frac * 16;
    const glowY = -p.h / 2 - 2;
    const glowGrad = ctx.createRadialGradient(0, glowY, 0, 0, glowY, glowR);
    glowGrad.addColorStop(0, "#eafbff");
    glowGrad.addColorStop(1, "rgba(111,201,238,0)");
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(0, glowY, glowR, 0, Math.PI * 2);
    ctx.fill();
  }

  // 吸収体 active: the hull itself turns black, the clearest possible
  // "this ship absorbs instead of bounces right now" cue - the outline
  // switches to white too, since the usual dark COLORS.textDark stroke
  // would barely show up against a black fill
  const absorbing = absorberT > 0;
  roundRectPath(-p.w / 2, -p.h / 2, p.w, p.h, 10);
  ctx.fillStyle = absorbing ? "#1a1a1a" : "#ffffff";
  ctx.fill();
  ctx.strokeStyle = absorbing ? "#ffffff" : COLORS.textDark;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = COLORS.accent;
  ctx.beginPath();
  ctx.moveTo(-p.w / 2, p.h / 2 - 6);
  ctx.lineTo(-p.w / 2 - 6, p.h / 2 + 2);
  ctx.lineTo(-p.w / 2, p.h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(p.w / 2, p.h / 2 - 6);
  ctx.lineTo(p.w / 2 + 6, p.h / 2 + 2);
  ctx.lineTo(p.w / 2, p.h / 2);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, -2, 8, 0, Math.PI * 2);
  ctx.fillStyle = "#bfe8ff";
  ctx.fill();
  ctx.strokeStyle = COLORS.textDark;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (p.triWayT > 0) {
    // fired up for the 3-way shot: raised confident eyebrows, bright
    // sparkling eyes, and a gritted determined grin
    ctx.strokeStyle = "#2a2440";
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-3.6, -5.4); ctx.lineTo(-1.1, -4.3);
    ctx.moveTo(3.6, -5.4); ctx.lineTo(1.1, -4.3);
    ctx.stroke();

    ctx.fillStyle = "#2a2440";
    ctx.beginPath(); ctx.arc(-2.4, -3, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(2.4, -3, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(-1.95, -3.4, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(2.85, -3.4, 0.5, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = "#2a2440";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-2.3, 0.6);
    ctx.lineTo(2.3, 0.6);
    ctx.stroke();
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-1.1, 0.6); ctx.lineTo(-1.1, 1.5);
    ctx.moveTo(0, 0.6); ctx.lineTo(0, 1.5);
    ctx.moveTo(1.1, 0.6); ctx.lineTo(1.1, 1.5);
    ctx.stroke();
  } else {
    ctx.fillStyle = "#2a2440";
    ctx.beginPath(); ctx.arc(-2.4, -3, 1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(2.4, -3, 1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -1, 2.2, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();
}

// small and constant except right AT a multiple of 5, where it pops up to a
// size that grows with how many milestones have been hit so far (capped at
// 18px - the gap between the ship and the field's bottom edge is only ~21px,
// see drawChainPopup() - not enough room for more without clipping against
// FIELD_BOTTOM). This reads as a rhythmic "pop" every 5th chain rather than
// a smooth/gradual staircase, so the milestone itself stands out
function chainPopupFontSize(n) {
  if (n % 5 !== 0) return 10;
  return Math.min(18, 11 + Math.floor(n / 5));
}
// white -> gold -> "Cherenkov blue" (the glow real reactor cores give off) -
// same 3-stage progression used for the daughter-neutron aura color below
function chainPopupColor(n) {
  if (n >= 50) return "#8be9ff";
  if (n >= 20) return "#ffd23f";
  return "#ffffff";
}

// "N連鎖！" popup anchored just below the ship (see chainPopupT/chainPopupN,
// set in registerChain()) - a big chain is otherwise only visible as a lot
// of small fast-moving neutrons/explosions, easy to miss if you can't track
// individual fast objects. This instead gives one big, legible, easy-to-spot
// signal right where the player is already looking. Size grows every 5
// chain, color escalates white -> gold -> Cherenkov blue at 20/50, so a long
// chain visibly ramps up in intensity.
// Anchored with textBaseline "top" at a fixed y regardless of size (rather
// than centered) because the gap between the ship and the field's bottom
// edge is only ~21px - not enough room for size growth to be centered
// without the tallest size clipping against FIELD_BOTTOM
function drawChainPopup() {
  if (chainPopupT <= 0) return;
  const n = chainPopupN;
  // a lone, un-chained fission (chainCount just reaching 1) happens on
  // basically every ordinary shot - far too common to be worth a popup, so
  // it's suppressed here rather than never being set at all (registerChain()
  // still tracks it normally; this is purely a display-time skip)
  if (n === 1) return;
  const fontSize = chainPopupFontSize(n);
  const color = chainPopupColor(n);
  // full opacity for most of the display, then a quick fade in the last
  // fraction of CHAIN_POPUP_DURATION - reads as "held, then dismissed"
  // rather than continuously fading from the moment it appears
  const alpha = Math.min(1, chainPopupT / (CHAIN_POPUP_DURATION * 0.4));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `bold ${fontSize}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(20, 15, 45, 0.85)";
  const text = `${n}れんさ！`;
  const x = player.x, y = player.y + player.h / 2 + 2;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// HUD text (player name, score/time, power label, neutron chain count) is
// rendered as real DOM elements (#hudOverlay, positioned/synced in
// positionHudOverlay()/syncHudDOM()) instead of ctx.fillText() - this only
// draws the card backgrounds, divider, and power gauge bar graphic
function drawHud() {
  ctx.save();

  const pl = CARD_PLAYER;
  drawCard(pl.x, pl.y, pl.w, pl.h);

  // score / time
  const st = CARD_SCORE_TIME;
  drawCard(st.x, st.y, st.w, st.h);
  ctx.beginPath();
  ctx.moveTo(st.x + st.w / 2, st.y + 8);
  ctx.lineTo(st.x + st.w / 2, st.y + st.h - 8);
  ctx.strokeStyle = "rgba(58,47,107,0.2)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // power
  const pc = CARD_POWER;
  drawCard(pc.x, pc.y, pc.w, pc.h);
  const gaugeX = pc.x + 12, gaugeY = pc.y + 24, gaugeW = pc.w - 24, gaugeH = 10;
  roundRectPath(gaugeX, gaugeY, gaugeW, gaugeH, 5);
  ctx.fillStyle = "rgba(58,47,107,0.12)";
  ctx.fill();
  const fillW = Math.max(0, (power / 100) * gaugeW);
  if (fillW > 2) {
    roundRectPath(gaugeX, gaugeY, fillW, gaugeH, 5);
    const g = ctx.createLinearGradient(gaugeX, 0, gaugeX + gaugeW, 0);
    g.addColorStop(0, "#5be37a");
    g.addColorStop(1, "#ffd23f");
    ctx.fillStyle = g;
    ctx.fill();
  }

  // neutron chain
  const cc = CARD_CHAIN;
  drawCard(cc.x, cc.y, cc.w, cc.h);

  ctx.restore();
}

// draws an isotope label with the mass number as a small superscript to the
// upper-left of the element symbol (e.g. the "90" above-left of "Sr")
function drawIsotopeLabel(x, y, massNumber, symbol, fontSize, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLORS.textDark;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const supFont = `bold ${Math.round(fontSize * 0.62)}px ${FONT}`;
  const symFont = `bold ${fontSize}px ${FONT}`;
  const supText = String(massNumber);
  ctx.font = supFont;
  const supWidth = ctx.measureText(supText).width;
  ctx.fillText(supText, x, y - fontSize * 0.38);
  ctx.font = symFont;
  ctx.fillText(symbol, x + supWidth * 0.85, y);
  ctx.restore();
}

// before the first fission there is no chart data yet, so this space instead
// explains what each nuclide does using the same chibi faces seen in the field
const FISSION_EXPLAINER_ROWS = [
  { type: TYPE_U235, mass: 235, symbol: "U", desc: "中性子があたると核分裂" },
  { type: TYPE_U238, mass: 238, symbol: "U", desc: "中性子を食べてPuに変身" },
  { type: TYPE_PU, mass: null, symbol: "Pu", desc: "中性子があたると核分裂" },
  { type: TYPE_B10, mass: 10, symbol: "B", desc: "中性子食べるだけ" },
];

// text content lives in #fissionExplainerOverlay (see syncFissionExplainerDOM())
// - this only draws the card background and the chibi-face icons
function drawFissionExplainer() {
  const c = FISSION_CHART;
  const panelW = c.panelRight - c.panelX;
  const panelH = c.panelBottom - c.panelTop;
  drawCard(c.panelX, c.panelTop, panelW, panelH);

  const rows = simConfig.b10Concentration > 0 ? FISSION_EXPLAINER_ROWS : FISSION_EXPLAINER_ROWS.filter((r) => r.type !== TYPE_B10);
  const startY = c.panelTop + 40;
  const rowH = (panelH - 48) / rows.length;
  const iconX = c.panelX + 28;

  rows.forEach((row, i) => {
    const cy = startY + rowH * i + rowH / 2;
    drawChibiFace(iconX, cy, 17, TYPE_COLORS[row.type], expressionForType(row.type));
  });
}

const fissionExplainerOverlayEl = document.getElementById("fissionExplainerOverlay");
const fissionExplainerHeaderEl = makeHudTextEl(fissionExplainerOverlayEl);
fissionExplainerHeaderEl.textContent = "げんしかくの しゅるい";
const fissionExplainerLabelEls = FISSION_EXPLAINER_ROWS.map(() => makeHudTextEl(fissionExplainerOverlayEl));
const fissionExplainerDescEls = FISSION_EXPLAINER_ROWS.map(() => makeHudTextEl(fissionExplainerOverlayEl, "regular"));

// only shown before the first fission of a run (while the explainer, rather
// than the yield chart, occupies this panel) and only during active play -
// hidden on the title/game-over screens so it can't show through behind them
function syncFissionExplainerDOM() {
  const visible = state === STATE_PLAYING && fissionHistory.length === 0;
  fissionExplainerOverlayEl.classList.toggle("hidden", !visible);
  if (!visible) return;

  const c = FISSION_CHART;
  const panelH = c.panelBottom - c.panelTop;
  const rows = simConfig.b10Concentration > 0 ? FISSION_EXPLAINER_ROWS : FISSION_EXPLAINER_ROWS.filter((r) => r.type !== TYPE_B10);
  const headerY = c.panelTop + 20;
  const startY = c.panelTop + 40;
  const rowH = (panelH - 48) / rows.length;
  const textX = c.panelX + 54;

  positionHudTextBaseline(fissionExplainerHeaderEl, c.panelX + 16, headerY, 14, currentUIScale);

  FISSION_EXPLAINER_ROWS.forEach((row, idx) => {
    const labelEl = fissionExplainerLabelEls[idx];
    const descEl = fissionExplainerDescEls[idx];
    const i = rows.indexOf(row);
    if (i === -1) {
      labelEl.textContent = "";
      descEl.textContent = "";
      return;
    }
    const cy = startY + rowH * i + rowH / 2;
    labelEl.innerHTML = row.mass !== null ? `<sup>${row.mass}</sup>${row.symbol}` : row.symbol;
    descEl.textContent = row.desc;
    positionHudTextBaseline(labelEl, textX, cy - 6, 14, currentUIScale);
    positionHudTextBaseline(descEl, textX, cy + 11, 11, currentUIScale);
  });
}

function drawFissionYieldChart() {
  const c = FISSION_CHART;
  const panelW = c.panelRight - c.panelX;
  const panelH = c.panelBottom - c.panelTop;
  drawCard(c.panelX, c.panelTop, panelW, panelH);

  const chartX = c.panelX + 10, chartRight = c.panelRight - 10;
  const chartW = chartRight - chartX;
  const chartH = c.baseY - c.chartTop;

  if (fissionABins.length > 0) {
    const barW = chartW / fissionABins.length;
    for (let i = 0; i < fissionABins.length; i++) {
      const count = fissionABins[i];
      if (count === 0) continue;
      const barH = (count / fissionABinMax) * chartH;
      const hue = 340 - (i / fissionABins.length) * 60;
      ctx.fillStyle = `hsl(${hue}, 80%, 62%)`;
      ctx.fillRect(chartX + i * barW, c.baseY - barH, Math.max(1, barW - 0.4), barH);
    }
  }

  ctx.strokeStyle = "rgba(58,47,107,0.4)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(chartX, c.baseY);
  ctx.lineTo(chartRight, c.baseY);
  ctx.stroke();

  // floating isotope name pop-ups, clipped to the card so they don't spill out
  ctx.save();
  roundRectPath(c.panelX, c.panelTop, panelW, panelH, 14);
  ctx.clip();
  for (const fl of floatingLabels) {
    const alpha = Math.max(0, 1 - fl.t / fl.dur);
    drawIsotopeLabel(fl.x, fl.y, fl.A, fl.symbol, 12, alpha);
  }
  ctx.restore();
}

// ---- title screen text, rendered as DOM overlay (see the HUD overlay near
// the top of this file for the same technique + rationale) ----
const titleOverlayEl = document.getElementById("titleOverlay");

function makeHudTextEl(parent, extraClass) {
  const el = document.createElement("div");
  el.className = extraClass ? `hudText ${extraClass}` : "hudText";
  parent.appendChild(el);
  return el;
}

const titleHeadingEl = makeHudTextEl(titleOverlayEl, "center titleLogo");
// the neutron symbol is lowercase "n" with mass number 1 as a superscript
// (same isotopeHTML() convention used for every other nuclide label in the
// game), not a capital "N" - "N Shooter" was a naming mistake
titleHeadingEl.innerHTML = `${isotopeHTML(1, "n")} Shooter`;
const titleSubtitleEl = makeHudTextEl(titleOverlayEl, "center");
titleSubtitleEl.textContent = "かくぶんれつ れんさはんのう シューティング";
const titleStartEl = makeHudTextEl(titleOverlayEl, "center");
titleStartEl.style.color = COLORS.pu;

const hsPlayerNameEl = makeHudTextEl(titleOverlayEl, "center");
const hsScoreHeaderEl = makeHudTextEl(titleOverlayEl, "center");
hsScoreHeaderEl.textContent = "得点👑";
hsScoreHeaderEl.style.color = COLORS.accent;
const hsChainHeaderEl = makeHudTextEl(titleOverlayEl, "center");
hsChainHeaderEl.textContent = "連鎖数🏆";
hsChainHeaderEl.style.color = COLORS.accent;
const hsMultHeaderEl = makeHudTextEl(titleOverlayEl, "center");
hsMultHeaderEl.textContent = "増倍率⚛️";
hsMultHeaderEl.style.color = COLORS.accent;
const hsScoreRowEls = [], hsChainRowEls = [], hsMultRowEls = [];
for (let i = 0; i < MAX_RECORDS; i++) {
  hsScoreRowEls.push(makeHudTextEl(titleOverlayEl, "center"));
  hsChainRowEls.push(makeHudTextEl(titleOverlayEl, "center"));
  hsMultRowEls.push(makeHudTextEl(titleOverlayEl, "center"));
}

// hidden-settings config panel (Shift+←→/↑↓): label text never changes at
// runtime (only its color, on selection), so it's set once here
const tcLabelEls = TITLE_CONFIG_PARAMS.map(() => makeHudTextEl(titleOverlayEl, "center"));
const tcValueEls = TITLE_CONFIG_PARAMS.map(() => makeHudTextEl(titleOverlayEl, "center"));
TITLE_CONFIG_PARAMS.forEach((p, i) => {
  tcLabelEls[i].innerHTML = p.massPrefix ? `<sup>${p.massPrefix}</sup>${p.symbolPrefix}${p.labelSuffix}` : p.label;
});

function positionTitleOverlay(scale) {
  const cx = GAME_W / 2, cy = GAME_H / 2;

  positionHudTextBaseline(titleHeadingEl, cx, cy - 26, 40, scale);
  positionHudTextBaseline(titleSubtitleEl, cx, cy + 12, 15, scale);
  positionHudTextBaseline(titleStartEl, cx, cy + 48, 15, scale);

  const hsPanelX = cx - HS_PANEL_W / 2, hsPanelY = 14;
  const leftCx = hsPanelX + HS_PANEL_W * (1 / 6);
  const midCx = hsPanelX + HS_PANEL_W * 0.5;
  const rightCx = hsPanelX + HS_PANEL_W * (5 / 6);
  const headerY = hsPanelY + 32;
  positionHudTextBaseline(hsPlayerNameEl, cx, hsPanelY + 16, 12, scale);
  positionHudTextBaseline(hsScoreHeaderEl, leftCx, headerY, 12, scale);
  positionHudTextBaseline(hsChainHeaderEl, midCx, headerY, 12, scale);
  positionHudTextBaseline(hsMultHeaderEl, rightCx, headerY, 12, scale);
  for (let i = 0; i < MAX_RECORDS; i++) {
    const y = headerY + 15 + i * 13;
    positionHudTextBaseline(hsScoreRowEls[i], leftCx, y, 10, scale);
    positionHudTextBaseline(hsChainRowEls[i], midCx, y, 10, scale);
    positionHudTextBaseline(hsMultRowEls[i], rightCx, y, 10, scale);
  }

  const tcPanelW = 430, tcPanelH = 148;
  const tcPanelX = cx - tcPanelW / 2, tcPanelY = cy + 76;
  const barTop = tcPanelY + 34;
  const barBottom = tcPanelY + tcPanelH - 26;
  const slotW = tcPanelW / TITLE_CONFIG_PARAMS.length;
  TITLE_CONFIG_PARAMS.forEach((p, i) => {
    const slotCx = tcPanelX + slotW * (i + 0.5);
    positionHudTextBaseline(tcLabelEls[i], slotCx, barTop - 10, 14, scale);
    positionHudTextBaseline(tcValueEls[i], slotCx, barBottom + 20, 15, scale);
  });
}

function syncTitleDOM() {
  const visible = state === STATE_TITLE;
  titleOverlayEl.classList.toggle("hidden", !visible);
  if (!visible) return;

  const bounce = Math.sin(fieldScrollY * 0.1) * 4;
  titleHeadingEl.style.transform = `translateX(-50%) translateY(${bounce}px)`;

  titleStartEl.textContent = TITLE_START_HINT_BY_DEVICE[lastInputDevice];

  // touch/mouse have no "C" key, but can already long-press (touch) or
  // right-click (mouse) the ranking panel to open name entry (see
  // titleNameHitZone(), handleTouchStart(), bindMouseEvents()'s contextmenu
  // handler) - say so instead
  const nameChangeHint = lastInputDevice === "touch" ? "長押しで変更"
    : lastInputDevice === "mouse" ? "右クリックで変更"
    : "[C]で変更";
  hsPlayerNameEl.textContent = `プレイヤー: ${playerName || DEFAULT_PLAYER_NAME}　${nameChangeHint}`;
  const scoreList = loadScoreRecords();
  const chainList = loadChainRecords();
  const multList = loadMultRecords();
  for (let i = 0; i < MAX_RECORDS; i++) {
    const s = scoreList[i], c = chainList[i], m = multList[i];
    hsScoreRowEls[i].textContent = s ? `${i + 1}位 ${s.name} ${s.score}点` : "";
    hsScoreRowEls[i].style.color = i === 0 ? COLORS.pu : COLORS.textDark;
    hsChainRowEls[i].textContent = c ? `${i + 1}位 ${c.name} ${c.chainMax}連鎖` : "";
    hsChainRowEls[i].style.color = i === 0 ? COLORS.pu : COLORS.textDark;
    hsMultRowEls[i].textContent = m ? `${i + 1}位 ${m.name} ${m.mult.toFixed(5)}` : "";
    hsMultRowEls[i].style.color = i === 0 ? COLORS.pu : COLORS.textDark;
  }

  TITLE_CONFIG_PARAMS.forEach((p, i) => {
    const color = i === titleConfigIndex ? COLORS.accent : COLORS.textDark;
    tcLabelEls[i].style.color = color;
    tcValueEls[i].style.color = color;
    tcValueEls[i].textContent = p.format(simConfig[p.key]);
  });
}

// text content lives in #titleOverlay (see syncTitleDOM()) - this only
// draws the card background and the header divider line
function drawHighScorePanel() {
  const cx = GAME_W / 2;
  const panelX = cx - HS_PANEL_W / 2, panelY = 14;
  ctx.save();
  drawCard(panelX, panelY, HS_PANEL_W, HS_PANEL_H);

  ctx.strokeStyle = "rgba(58,47,107,0.15)";
  ctx.lineWidth = 1;
  // two dividers, splitting the panel into three equal columns (score /
  // chain / mult - see positionTitleOverlay()'s leftCx/midCx/rightCx)
  for (const fx of [1 / 3, 2 / 3]) {
    ctx.beginPath();
    ctx.moveTo(panelX + HS_PANEL_W * fx, panelY + 24);
    ctx.lineTo(panelX + HS_PANEL_W * fx, panelY + HS_PANEL_H - 8);
    ctx.stroke();
  }

  ctx.restore();
}

// text content lives in #titleOverlay (see syncTitleDOM()) - this only
// draws the dim background and the title card
function drawTitle() {
  ctx.save();
  ctx.fillStyle = "rgba(40,25,90,0.45)";
  ctx.fillRect(0, 0, GAME_W, GAME_H);

  const cx = GAME_W / 2, cy = GAME_H / 2;
  const cardW = 380, cardH = 140;
  drawCard(cx - cardW / 2, cy - cardH / 2, cardW, cardH);
  ctx.restore();

  drawHighScorePanel();
  drawTitleConfigPanel();
  drawRankingResetStatus();
}

// only ever visible to whoever is actually mid-gesture (see
// updateRankingResetGesture()) - silent the rest of the time, so it never
// hints at the feature's existence to a casual visitor who isn't already
// holding something down
function drawRankingResetStatus() {
  if (rankingResetPhase === "idle") return;
  const isHolding = rankingResetPhase === "holding1" || rankingResetPhase === "holding2";
  const text = isHolding
    ? `● ${Math.ceil(RANKING_RESET_HOLD_DURATION - rankingResetT)}`
    : "ランキングをリセットしますか？もう一度同じ操作で確定";
  ctx.save();
  ctx.font = `bold 13px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = GAME_W / 2, y = GAME_H - 12;
  const w = ctx.measureText(text).width + 20;
  ctx.fillStyle = "rgba(20,15,45,0.85)";
  roundRectPath(cx - w / 2, y - 12, w, 24, 12);
  ctx.fill();
  ctx.fillStyle = "#ffd23f";
  ctx.fillText(text, cx, y + 1);
  ctx.restore();
}

// equalizer-style meter panel below the title card: Shift+←/→ picks a bar,
// Shift+↑/↓ raises/lowers it, matching the horizontal-select/vertical-adjust
// control scheme spatially (left-right movement selects, up-down movement adjusts)
function drawTitleConfigPanel() {
  const cx = GAME_W / 2, cy = GAME_H / 2;
  const panelW = 430, panelH = 148;
  const panelX = cx - panelW / 2, panelY = cy + 76;

  ctx.save();
  drawCard(panelX, panelY, panelW, panelH);

  const barTop = panelY + 34;
  const barBottom = panelY + panelH - 26;
  const barH = barBottom - barTop;
  const slotW = panelW / TITLE_CONFIG_PARAMS.length;
  const barW = 18;

  TITLE_CONFIG_PARAMS.forEach((p, i) => {
    const slotCx = panelX + slotW * (i + 0.5);
    const selected = i === titleConfigIndex;
    const frac = Math.max(0, Math.min(1, (simConfig[p.key] - p.min) / (p.max - p.min)));

    roundRectPath(slotCx - barW / 2, barTop, barW, barH, 6);
    ctx.fillStyle = "rgba(58,47,107,0.12)";
    ctx.fill();

    // at the true minimum (frac === 0) the bar should read as fully empty
    // (just the gray background) - the Math.max(3, ...) floor only kicks in
    // for actual nonzero values, so a tiny sliver doesn't round away to
    // nothing, without also giving the minimum itself a false sliver of fill
    if (frac > 0) {
      const fillH = Math.max(3, frac * barH);
      // the fill's bottom edge always sits exactly on the track's own bottom
      // edge, so instead of rounding it separately (which would fight the
      // track's fixed 6px radius whenever fillH is too short to also carry
      // a 6px corner - see the clamped radius this replaced), clip to the
      // track's own rounded shape and let THAT define the bottom curve, so
      // it always matches exactly regardless of fillH. Only the top corners
      // (which never coincide with a track edge unless the fill is nearly
      // full) get their own small radius, clamped the same way as before so
      // a short fill's top cap doesn't self-intersect either.
      const topR = Math.min(6, fillH / 2, barW / 2);
      ctx.save();
      roundRectPath(slotCx - barW / 2, barTop, barW, barH, 6);
      ctx.clip();
      topRoundRectPath(slotCx - barW / 2, barBottom - fillH, barW, fillH, topR);
      const grad = ctx.createLinearGradient(0, barBottom, 0, barTop);
      grad.addColorStop(0, "#5be37a");
      grad.addColorStop(1, "#ffd23f");
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
    }

    if (selected) {
      roundRectPath(slotCx - barW / 2 - 4, barTop - 4, barW + 8, barH + 8, 8);
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });

  ctx.restore();
}

// ---- periodic-table panel (game-over screen) ----
// lays out every element that can actually appear as a fission product
// (Z23 V through Z70 Yb - the full contiguous range across both the U235 and
// Pu239 yield tables) at its real periodic-table position, so the panel
// reads as a recognizable (if partial) periodic table rather than an
// arbitrary grid. Z19-22 (K/Ca/Sc/Ti) are included as unlabeled spacer cells
// purely so period 4's columns line up correctly under period 5 - they can
// never actually be obtained, since no fission product is that light.
// each element's "cat" is its periodic-table family (alkali/alkalineEarth/
// transition/postTransition/metalloid/reactive[halogen-ish nonmetal]/
// nobleGas/lanthanide) - see PERIODIC_CATEGORY_STYLE below for how families
// map to colors. Spacer cells (Z19-22) carry no category.
const PERIODIC_ELEMENTS = [
  // period 4
  { z: 19, sym: "K", row: 0, col: 1 }, { z: 20, sym: "Ca", row: 0, col: 2 },
  { z: 21, sym: "Sc", row: 0, col: 3 }, { z: 22, sym: "Ti", row: 0, col: 4 },
  { z: 23, sym: "V", row: 0, col: 5, cat: "transition" }, { z: 24, sym: "Cr", row: 0, col: 6, cat: "transition" },
  { z: 25, sym: "Mn", row: 0, col: 7, cat: "transition" }, { z: 26, sym: "Fe", row: 0, col: 8, cat: "transition" },
  { z: 27, sym: "Co", row: 0, col: 9, cat: "transition" }, { z: 28, sym: "Ni", row: 0, col: 10, cat: "transition" },
  { z: 29, sym: "Cu", row: 0, col: 11, cat: "transition" }, { z: 30, sym: "Zn", row: 0, col: 12, cat: "transition" },
  { z: 31, sym: "Ga", row: 0, col: 13, cat: "postTransition" }, { z: 32, sym: "Ge", row: 0, col: 14, cat: "metalloid" },
  { z: 33, sym: "As", row: 0, col: 15, cat: "metalloid" }, { z: 34, sym: "Se", row: 0, col: 16, cat: "reactive" },
  { z: 35, sym: "Br", row: 0, col: 17, cat: "reactive" }, { z: 36, sym: "Kr", row: 0, col: 18, cat: "nobleGas" },
  // period 5
  { z: 37, sym: "Rb", row: 1, col: 1, cat: "alkali" }, { z: 38, sym: "Sr", row: 1, col: 2, cat: "alkalineEarth" },
  { z: 39, sym: "Y", row: 1, col: 3, cat: "transition" }, { z: 40, sym: "Zr", row: 1, col: 4, cat: "transition" },
  { z: 41, sym: "Nb", row: 1, col: 5, cat: "transition" }, { z: 42, sym: "Mo", row: 1, col: 6, cat: "transition" },
  { z: 43, sym: "Tc", row: 1, col: 7, cat: "transition" }, { z: 44, sym: "Ru", row: 1, col: 8, cat: "transition" },
  { z: 45, sym: "Rh", row: 1, col: 9, cat: "transition" }, { z: 46, sym: "Pd", row: 1, col: 10, cat: "transition" },
  { z: 47, sym: "Ag", row: 1, col: 11, cat: "transition" }, { z: 48, sym: "Cd", row: 1, col: 12, cat: "transition" },
  { z: 49, sym: "In", row: 1, col: 13, cat: "postTransition" }, { z: 50, sym: "Sn", row: 1, col: 14, cat: "postTransition" },
  { z: 51, sym: "Sb", row: 1, col: 15, cat: "metalloid" }, { z: 52, sym: "Te", row: 1, col: 16, cat: "metalloid" },
  { z: 53, sym: "I", row: 1, col: 17, cat: "reactive" }, { z: 54, sym: "Xe", row: 1, col: 18, cat: "nobleGas" },
  // period 6 (only Cs/Ba appear before the lanthanide block starts)
  { z: 55, sym: "Cs", row: 2, col: 1, cat: "alkali" }, { z: 56, sym: "Ba", row: 2, col: 2, cat: "alkalineEarth" },
  // lanthanides: their own row again (not folded into Cs/Ba's row 2) so they
  // read as a visually distinct block, but row 3 sits only 14px below row 2
  // instead of a full PT_ROW_PITCH - see PT_ROW_Y's own comment for why that
  // sliver is enough (no shared columns with Cs/Ba to collide with)
  { z: 57, sym: "La", row: 3, col: 3, cat: "lanthanide" }, { z: 58, sym: "Ce", row: 3, col: 4, cat: "lanthanide" },
  { z: 59, sym: "Pr", row: 3, col: 5, cat: "lanthanide" }, { z: 60, sym: "Nd", row: 3, col: 6, cat: "lanthanide" },
  { z: 61, sym: "Pm", row: 3, col: 7, cat: "lanthanide" }, { z: 62, sym: "Sm", row: 3, col: 8, cat: "lanthanide" },
  { z: 63, sym: "Eu", row: 3, col: 9, cat: "lanthanide" }, { z: 64, sym: "Gd", row: 3, col: 10, cat: "lanthanide" },
  { z: 65, sym: "Tb", row: 3, col: 11, cat: "lanthanide" }, { z: 66, sym: "Dy", row: 3, col: 12, cat: "lanthanide" },
  { z: 67, sym: "Ho", row: 3, col: 13, cat: "lanthanide" }, { z: 68, sym: "Er", row: 3, col: 14, cat: "lanthanide" },
  { z: 69, sym: "Tm", row: 3, col: 15, cat: "lanthanide" }, { z: 70, sym: "Yb", row: 3, col: 16, cat: "lanthanide" },
  // actinides: only the 3 nuclides this game's ship can actually discover
  // (see the 吸収体 touch-scan in spawnAndUpdateTargets()), placed directly under Nd/Pm/Sm -
  // row 4 sits PT_CELL_H+2px below row 3 (the minimum that doesn't overlap,
  // since these DO share columns 6-8 with Nd/Pm/Sm right above them)
  { z: 92, sym: "U", row: 4, col: 6, cat: "actinide" }, { z: 93, sym: "Np", row: 4, col: 7, cat: "actinide" },
  { z: 94, sym: "Pu", row: 4, col: 8, cat: "actinide" },
];
const PERIODIC_OBTAINABLE_MIN_Z = 23;
const PERIODIC_OBTAINABLE_ELEMENTS = PERIODIC_ELEMENTS.filter((e) => e.z >= PERIODIC_OBTAINABLE_MIN_Z);
const PERIODIC_TOTAL_OBTAINABLE = PERIODIC_OBTAINABLE_ELEMENTS.length;

// ---- decay-chain walker (game-over periodic-table drill-down) ----
// NUCLIDE_DECAY_DB (data/decay_data.js) is a Z19-78 subset of an IAEA-sourced
// decay database: NUCLIDE_DECAY_DB[Z] is a comma-separated list of entries
// "A:Mode1:Ratio1:Mode2:Ratio2:Mode3:Ratio3:HalfLifeSeconds" for every known
// isotope of that element. HalfLife is 'S' (stable), '?' (unknown), 'V'
// (sub-nanosecond), or seconds. A row with no modes at all (just the half
// life field) is stable.

// element symbols for the Z range decay chains can actually reach: starting
// fragments are Z~30-65, and beta-minus decay (the dominant path for
// neutron-rich fission products) walks upward in Z a few steps at a time
// toward the stability valley, so this needs a bit of margin either side of
// NUCLIDE_DECAY_DB's own Z19-78 range rather than matching it exactly
const ELEMENT_SYMBOL_BY_Z = {
  10: "Ne", 11: "Na", 12: "Mg", 13: "Al", 14: "Si", 15: "P", 16: "S", 17: "Cl", 18: "Ar",
  19: "K", 20: "Ca", 21: "Sc", 22: "Ti", 23: "V", 24: "Cr", 25: "Mn", 26: "Fe", 27: "Co",
  28: "Ni", 29: "Cu", 30: "Zn", 31: "Ga", 32: "Ge", 33: "As", 34: "Se", 35: "Br", 36: "Kr",
  37: "Rb", 38: "Sr", 39: "Y", 40: "Zr", 41: "Nb", 42: "Mo", 43: "Tc", 44: "Ru", 45: "Rh",
  46: "Pd", 47: "Ag", 48: "Cd", 49: "In", 50: "Sn", 51: "Sb", 52: "Te", 53: "I", 54: "Xe",
  55: "Cs", 56: "Ba", 57: "La", 58: "Ce", 59: "Pr", 60: "Nd", 61: "Pm", 62: "Sm", 63: "Eu",
  64: "Gd", 65: "Tb", 66: "Dy", 67: "Ho", 68: "Er", 69: "Tm", 70: "Yb", 71: "Lu", 72: "Hf",
  73: "Ta", 74: "W", 75: "Re", 76: "Os", 77: "Ir", 78: "Pt", 79: "Au", 80: "Hg", 81: "Tl",
  82: "Pb", 83: "Bi", 84: "Po", 85: "At", 86: "Rn", 87: "Fr", 88: "Ra", 89: "Ac", 90: "Th",
  91: "Pa", 92: "U", 93: "Np", 94: "Pu",
};
function elementSymbolForZ(z) {
  return ELEMENT_SYMBOL_BY_Z[z] || `Z${z}`;
}

// Xe-135 and Sm-149: the two classic "reactor poison" fission-product
// nuclides, whose enormous thermal-neutron capture cross-section is exactly
// what makes them soak up neutrons that would otherwise sustain a chain
// reaction (see spawnFragment()/updateFragments()'s poison handling below)
function isPoisonNuclide(z, a) {
  return (z === 54 && a === 135) || (z === 62 && a === 149);
}

// (dz, da) per decay-mode token, derived from every token actually present in
// NUCLIDE_DECAY_DB (see the extraction script that generated data/decay_data.js) -
// compound tokens like "B-N" (beta-minus then delayed neutron emission) or
// "ECA" (electron capture then alpha) apply both steps' effects at once, since
// the database records them as a single branch rather than two separate rows.
// IT (isomeric transition, a gamma-only de-excitation) leaves (Z,A) unchanged,
// so it's treated as a terminal step in the chain walker rather than looped on.
const DECAY_MODE_EFFECT = {
  "A": { dz: -2, da: -4, label: "α" },
  "B+": { dz: -1, da: 0, label: "β⁺" },
  "B+A": { dz: -3, da: -4, label: "β⁺+α" },
  "B+P": { dz: -2, da: -1, label: "β⁺+p" },
  "B-": { dz: 1, da: 0, label: "β⁻" },
  "B-2N": { dz: 1, da: -2, label: "β⁻+2n" },
  "B-3N": { dz: 1, da: -3, label: "β⁻+3n" },
  "B-4N": { dz: 1, da: -4, label: "β⁻+4n" },
  "B-N": { dz: 1, da: -1, label: "β⁻+n" },
  "EC": { dz: -1, da: 0, label: "EC" },
  "EC+B+": { dz: -1, da: 0, label: "EC/β⁺" },
  "EC2P": { dz: -3, da: -2, label: "EC+2p" },
  "ECA": { dz: -3, da: -4, label: "EC+α" },
  "ECP": { dz: -2, da: -1, label: "EC+p" },
  "IT": { dz: 0, da: 0, label: "IT(γ)" },
  "P": { dz: -1, da: -1, label: "p" },
  "2B+": { dz: -2, da: 0, label: "2β⁺" },
  "2B-": { dz: 2, da: 0, label: "2β⁻" },
  "2EC": { dz: -2, da: 0, label: "2EC" },
  "2P": { dz: -2, da: -2, label: "2p" },
};

// unified radiation-type color scheme, shared by the live in-field decay
// trails (spawnDecayTrail()/decayTrailStyle()) and the game-over decay-chain
// diagram (decayNodeColor()) - one color per emitted-particle family, used
// consistently everywhere in the game instead of each screen inventing its
// own palette. alpha keeps the orange it already had in the live trails;
// EC/beta+ gets its own color instead of being lumped in with beta-minus
// (previously both were just "not alpha" and shared the blue beta color).
const ALPHA_COLOR = "#ff8a3d"; // orange - heavy particle, short/thick track
const BETA_MINUS_COLOR = "#4fc3ff"; // blue - the dominant path for real fission products
const EC_BETA_PLUS_COLOR = "#8b6bff"; // violet (matches COLORS.pu) - proton-rich-side decay, rare for fission products (see the light-mass-tail discussion)
const GAMMA_COLOR = "#ffe066"; // bright gold - a gamma photon, same family as ANNIHILATION_GAMMA_COLOR below (an annihilation photon IS a gamma ray, just from a different origin)
// beta+ (the positron) gets its own color, split out from the general
// EC_BETA_PLUS_COLOR umbrella above - see spawnECOrBetaPlusEvent(). Pink/
// magenta reads as "matter's mirror image" against beta-minus's blue (a
// common matter=blue / antimatter=pink convention), while staying clearly
// apart from alpha's orange and EC's violet
const BETA_PLUS_COLOR = "#ff3fb8";
const ANNIHILATION_GAMMA_COLOR = "#ffe066"; // bright gold - the pair-annihilation photon pair, distinct from any charged-particle color
// EC's own real signature (a characteristic X-ray from the atom's shell
// readjusting, see spawnCharacteristicXray()) is physically a different
// photon energy than a nuclear gamma ray, so it gets its own color instead
// of sharing GAMMA_COLOR - emerald green, clearly apart from gamma's gold
// and from EC_BETA_PLUS_COLOR's violet (used only for the decay-chain
// diagram/proton-emission tracks, not this live in-field flash)
const CHARACTERISTIC_XRAY_COLOR = "#00e699";

// classifies a decay mode by which particle family it emits, from
// DECAY_MODE_EFFECT's own dz/da/label - "alpha" takes priority over
// direction (so B+A/ECA, which combine a direction change with an alpha
// emission, still read as alpha, matching what a detector would actually see
// flying out); anything else with dz<0 (EC, beta+, or bare proton emission)
// is lumped into the ecBetaPlus family, since none of those are common
// enough among real fission products to deserve their own 4th color
function decayParticleKind(mode) {
  const eff = DECAY_MODE_EFFECT[mode];
  if (!eff) return null;
  if (eff.label.includes("α")) return "alpha";
  if (eff.dz === 0 && eff.da === 0) return "gamma";
  if (eff.dz > 0) return "betaMinus";
  return "ecBetaPlus";
}
function decayParticleColor(kind) {
  if (kind === "alpha") return ALPHA_COLOR;
  if (kind === "betaMinus") return BETA_MINUS_COLOR;
  if (kind === "ecBetaPlus") return EC_BETA_PLUS_COLOR;
  return GAMMA_COLOR;
}

// finds nuclide (z,a)'s row in NUCLIDE_DECAY_DB and returns its parsed decay
// modes (empty array = stable) plus half-life; null if the nuclide isn't in
// this trimmed database at all
function lookupNuclideEntry(z, a) {
  const row = NUCLIDE_DECAY_DB[z];
  if (!row) return null;
  const prefix = a + ":";
  for (const e of row.split(",")) {
    if (!e.startsWith(prefix)) continue;
    const parts = e.split(":");
    const modes = [];
    for (const i of [1, 3, 5]) {
      if (parts[i]) modes.push({ mode: parts[i], ratio: parts[i + 1] });
    }
    return { modes, halfLife: parts[7] };
  }
  return null;
}

// picks one decay mode, weighted by its listed branching ratio - reproduces
// the real probabilistic nature of branching decay instead of always taking
// the dominant path. A missing ratio (rare - IAEA just didn't record an exact
// number for that branch) falls back to a small nonzero weight so it's still
// reachable but stays unlikely relative to well-measured branches.
function pickWeightedMode(modes) {
  const weights = modes.map((m) => {
    const r = Number(m.ratio);
    return Number.isFinite(r) && r > 0 ? r : 1;
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < modes.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return modes[i];
  }
  return modes[modes.length - 1];
}

function formatHalfLife(raw) {
  if (raw === "S") return "安定";
  if (!raw || raw === "?") return "半減期不明";
  if (raw === "V") return "極短時間";
  const s = Number(raw);
  if (!Number.isFinite(s)) return raw;
  // sub-second half-lives (e.g. Po-215's real ~1.78ms, plenty common among
  // the alpha emitters partway down the U235/U238 natural decay series) used
  // to round straight to a meaningless "0.00秒" - step down through ms/μs/ns
  // instead, same "<10 gets 2 decimals" precision rule as the >=1s tiers below
  if (s < 1) {
    if (s < 1e-6) return (s * 1e9).toFixed(s * 1e9 < 10 ? 2 : 1) + "ns";
    if (s < 1e-3) return (s * 1e6).toFixed(s * 1e6 < 10 ? 2 : 1) + "μs";
    return (s * 1e3).toFixed(s * 1e3 < 10 ? 2 : 1) + "ms";
  }
  if (s < 60) return (s < 10 ? s.toFixed(2) : s.toFixed(1)) + "秒";
  if (s < 3600) return (s / 60).toFixed(1) + "分";
  if (s < 86400) return (s / 3600).toFixed(1) + "時間";
  if (s < 31557600) return (s / 86400).toFixed(1) + "日";
  const years = s / 31557600;
  if (years < 1e5) return years.toFixed(1) + "年";
  // extremely long-lived (e.g. K-40's ~1.25 billion years) reads better as
  // a×10^n than a wall of digits - uses <sup> like every other exponent-ish
  // notation in the game (isotopeHTML() etc), since this only ever lands in
  // an innerHTML-assigned arrow label (see syncPeriodicTableDOM()'s level 2 branch)
  let exp = Math.floor(Math.log10(years));
  let mantissa = years / Math.pow(10, exp);
  if (mantissa >= 9.995) { mantissa /= 10; exp += 1; } // rounding at the boundary (e.g. 9.996 -> "10.00") would misplace the exponent
  return `${mantissa.toFixed(2)}×10<sup>${exp}</sup>年`;
}

// branching-ratio percentage for the rare-event log (see recordRareEvent()) -
// this is the whole reason a row is worth showing at all ("why is this
// rare?"), so tiny ratios render in the same mantissa×10^exp style as
// formatHalfLife()'s extreme-value case instead of a wall of leading zeros;
// larger ratios (>=1%) are common enough to just read as plain digits.
// null when the source data didn't record a ratio for this branch at all
// (see lookupNuclideEntry() - pickWeightedMode() still picks it, just with
// an assumed fallback weight, so there's nothing real to display here)
function formatRatioPercent(ratio) {
  const r = Number(ratio);
  if (!Number.isFinite(r) || r <= 0) return null;
  if (r >= 1) return `${Number.isInteger(r) ? r : r.toFixed(1)}%`;
  let exp = Math.floor(Math.log10(r));
  let mantissa = r / Math.pow(10, exp);
  if (mantissa >= 9.995) { mantissa /= 10; exp += 1; }
  return `${mantissa.toFixed(1)}×10<sup>${exp}</sup>%`;
}

// "半減期56.6秒の" style prefix for the delayed-neutron log message (see
// updateFragments()) - formatHalfLife()'s "?" branch already spells out
// "半減期不明" on its own, so prepending "半減期" again there would read as
// "半減期半減期不明"; skipped for "S" too since a precursor mid-decay is by
// definition not stable, so that case shouldn't come up in practice
function delayedNeutronHalfLifeLabel(raw) {
  if (raw === "S") return "";
  const formatted = formatHalfLife(raw);
  return (raw === "?" || !raw ? formatted : `半減期${formatted}`) + "の";
}

// walks from the obtained fragment (startZ, startA) toward stability, sampling
// one branch at a time (see pickWeightedMode). Returns a list of steps, each
// { z, a, mode?, halfLife? } (mode/halfLife describe how THIS step decays into
// the next one) with the final step instead carrying a `terminal` reason:
// "stable" | "unknown" (not in the trimmed DB) | "IT" (gamma, same nuclide) |
// "maxDepth" (chain kept going past the display cap)
// 16, not 8: large enough that U235/U238/Np239/Pu239's real natural decay
// series (12-15 steps, see the periodic table's actinide row) all walk all
// the way to their real stable lead endpoint instead of being cut off - the
// display side handles chains this long via pagination (see
// DECAY_CHAIN_NODES_PER_PAGE/ptChainPage), not by cramming them into one page
const DECAY_CHAIN_MAX_STEPS = 16;
function walkDecayChain(startZ, startA) {
  const steps = [{ z: startZ, a: startA }];
  let z = startZ, a = startA;
  for (let i = 0; i < DECAY_CHAIN_MAX_STEPS; i++) {
    const entry = lookupNuclideEntry(z, a);
    const last = steps[steps.length - 1];
    if (!entry) { last.terminal = "unknown"; return steps; }
    if (entry.modes.length === 0) { last.terminal = "stable"; return steps; }
    const picked = pickWeightedMode(entry.modes);
    const effect = DECAY_MODE_EFFECT[picked.mode];
    last.mode = picked.mode;
    last.halfLife = entry.halfLife;
    if (!effect || (effect.dz === 0 && effect.da === 0)) {
      last.terminal = effect ? "IT" : "unknown";
      return steps;
    }
    z += effect.dz;
    a += effect.da;
    steps.push({ z, a });
  }
  steps[steps.length - 1].terminal = "maxDepth";
  return steps;
}

// modes whose decay is immediately followed by neutron emission - the
// nuclide undergoing one of these IS a "遅発中性子先行核" (delayed-neutron
// precursor), the reason real reactors are controllable at all despite
// fission itself being over in femtoseconds (see the "崩壊のその先を教える"
// discussion this whole browser grew out of) - worth calling out visually
const DELAYED_NEUTRON_MODES = new Set(["B-N", "B-2N", "B-3N", "B-4N"]);
// the general pink accent color reads too soft against the white card here
// (low contrast, easy to miss); this reuses the same strong red the
// game-over "×" close button uses for "pay attention to this" instead
const DELAYED_NEUTRON_COLOR = "#e8384f";
// color per rare-event type for the game-over "発見したレア核反応" table
// (see recordRareEvent()) - deliberately NOT DELAYED_NEUTRON_COLOR/
// ANNIHILATION_GAMMA_COLOR (those stay exclusive to the live-gameplay log
// messages, along with each event's 🔑/💥 icon - the table itself carries no
// icon, only this color): both a precursor's β⁻+n decay and an annihilation
// event's underlying decay are, physically, specifically a β⁻ or β⁺ process
// (see DECAY_MODE_EFFECT/decayParticleKind()) - so instead of gold-on-white
// (ANNIHILATION_GAMMA_COLOR, ~1.3:1 contrast - illegible) or a generic alert
// red unrelated to either particle, these are the same blue/magenta hues as
// BETA_MINUS_COLOR/BETA_PLUS_COLOR, darkened enough to read clearly as plain
// text on the white game-over card (those two were tuned for visibility as
// bright trails against the dark in-field backdrop, a very different
// contrast requirement)
const RARE_EVENT_TYPE_INFO = {
  delayedNeutron: { color: "#1d6fa5" },
  annihilation: { color: "#a02673" },
};

// level-2 of the decay browser draws each nuclide as a colored circle (the
// same chibi-face-style radial-gradient fill used for in-field targets - see
// drawChibiFace()) strung together with arrows, instead of a single line of
// text - a plain-text chain reads as "just another log message"; circles that
// change color as Z climbs or falls make the shape of a chain register at a
// glance even before reading a single label. Circle color tells the *outgoing*
// story of that nuclide (which way Z is about to move); the terminal node
// (no outgoing mode) is colored by how the chain ended instead.
function decayNodeColor(step) {
  // a halfLife of "S" means no decay has ever actually been observed for
  // this nuclide, even when the source data also lists a purely theoretical
  // mode (e.g. Nd-148's double-beta candidacy) - the diagram still draws the
  // arrow for that theoretical step, but colors the nuclide itself green
  // like any other practically-stable node instead of by its (unconfirmed) mode
  if (step.halfLife === "S") return COLORS.u238;
  if (step.mode) {
    const kind = decayParticleKind(step.mode);
    // orange=alpha, blue=beta-minus, violet=EC/beta+ (see decayParticleColor())
    if (kind && kind !== "gamma") return decayParticleColor(kind);
  }
  if (step.terminal === "stable") return COLORS.u238; // green: reached the stability valley
  return GAMMA_COLOR; // gold: IT (γ), unknown, or cut off (maxDepth)
}

// ---- real-time decay-chain effect ----
// each fission event's two fragments (see handleFissionHit()) walk their own
// real decay chain in the background, reusing
// the exact same lookupNuclideEntry/pickWeightedMode/DECAY_MODE_EFFECT
// machinery the game-over decay-chain browser drives. An ordinary fragment is
// never drawn (a circle+label per fragment read as clutter) - only the
// single line of emitted radiation flashes at its current position each time
// it decays, so what's visible is an "avalanche" of independent flashes
// scattered across the field as fragments decay one after another. The one
// exception is a poison nuclide (Xe-135/Sm-149, see isPoisonNuclide()): it
// lingers and matters for gameplay, so it IS drawn, as a chibi face (see
// drawFragments()). The one thing that ISN'T reused verbatim is the real
// halfLife: those range from nanoseconds to millions of years, so there's no
// honest way to play them back tick-for-tick at human timescale. Instead
// each nuclide's halfLife sorts it into one of 5 coarse, log-scaled tempo
// tiers (sub-second / seconds-to-minute / minutes-to-hour / hour-to-day /
// day-or-longer), and the actual per-step wait is a random draw within that
// tier's range - so a short-lived daughter visibly flickers faster than a
// long-lived one (the "rhythm" tracks the real half-life's scale) while
// still reading as probabilistic rather than a metronome, the same way real
// decay is a random process rather than a fixed clock.
const FRAGMENT_MAX_COUNT = 24; // oldest gets dropped past this (see spawnFragment() for the poison-nuclide eviction exception)
const FRAGMENT_FALL_SPEED = 16;
// a poison nuclide is visible and gameplay-relevant (see below), unlike an
// ordinary fragment - falls at a fresh target's own average speed (see
// spawnTarget()'s vy: 25 + random*35) so it reads as "just another thing in
// the field to deal with" rather than a lightweight background flake
const POISON_FALL_SPEED = 42.5;
// pale hydrangea (紫陽花) purple - a pastel, pink-leaning lavender chosen to
// stay clearly apart from both COLORS.b10's cool gray-blue (#aab3cf, B10's
// own target color) and COLORS.pu's saturated blue-violet (#8b6bff, Pu's
// target color AND EC_BETA_PLUS_COLOR) - a poison nuclide shouldn't be
// mistakable for either target it's floating alongside
const POISON_COLOR = "#d4a5e0";
const FRAGMENT_WALL_MARGIN = 10; // invisible, but still bounces off the field walls like everything else in the water
const FRAGMENT_STEP_TIER_RANGES = [
  [0.25, 0.45], // < 1s (or 'V', sub-nanosecond) - flickers fast
  [0.45, 0.7],  // 1s - 1min
  [0.65, 0.95], // 1min - 1hour
  [0.9, 1.3],   // 1hour - 1day
  [1.2, 1.8],   // >= 1day, or halfLife unknown ('?') - lingers slowest
];
function fragmentStepTier(halfLifeRaw) {
  if (halfLifeRaw === "V") return 0;
  const s = Number(halfLifeRaw);
  if (!Number.isFinite(s)) return 4; // '?' (not recorded) or unparsable
  if (s < 1) return 0;
  if (s < 60) return 1;
  if (s < 3600) return 2;
  if (s < 86400) return 3;
  return 4;
}
function fragmentStepDuration(halfLifeRaw) {
  const [min, max] = FRAGMENT_STEP_TIER_RANGES[fragmentStepTier(halfLifeRaw)];
  return min + Math.random() * (max - min);
}

// (re)starts the countdown to this fragment's next decay: looks up its
// current (z,a) and picks a branch weighted by real branching ratio, same as
// walkDecayChain()'s pickWeightedMode() step. The outcome is held fixed for
// the whole countdown so it doesn't change branch mid-countdown.
function armFragmentDecayStep(f) {
  // a poison nuclide's decay chain is held in place until it captures a
  // neutron (see updateFragments()'s (n,γ) loop) - no pendingMode/stepDur
  // countdown gets armed at all while it's poisoned
  if (isPoisonNuclide(f.z, f.a)) { f.isPoison = true; return; }
  const entry = lookupNuclideEntry(f.z, f.a);
  if (!entry) { f.terminal = "unknown"; return; }
  // some source rows list a purely theoretical mode (e.g. double-beta) on a
  // nuclide whose halfLife is still flagged "S" because no decay has ever
  // actually been observed (see Nd-148: "148:2B-::::::S") - honor the "S"
  // flag as the authoritative stability signal so gameplay doesn't perform a
  // decay real experiments have never seen
  if (entry.modes.length === 0 || entry.halfLife === "S") { f.terminal = "stable"; return; }
  const picked = pickWeightedMode(entry.modes);
  f.pendingMode = picked.mode;
  f.pendingRatio = picked.ratio; // this branch's own ratio (may be "" if the source data didn't record one) - for the rare-event log (see recordRareEvent())
  f.pendingHalfLife = entry.halfLife; // this nuclide's own half-life, for the delayed-neutron log message (see updateFragments())
  f.stepT = 0;
  f.stepDur = fragmentStepDuration(entry.halfLife);
}

function spawnFragment(x, y, z, a, gen) {
  const angle = Math.random() * Math.PI * 2;
  const speed = 40 + Math.random() * 70;
  const isP = isPoisonNuclide(z, a);
  const f = {
    x, y,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    z, a, gen,
    stepsDone: 0, terminal: null,
    isPoison: isP,
    poisonSource: isP ? { fromFission: true } : undefined,
    poisonSpawnT: isP ? 0 : undefined,
  };
  // a poison-born fragment already knows it's poison (isP, above) -
  // armFragmentDecayStep() would just re-derive that same isPoisonNuclide()
  // result and return without arming anything, so only bother calling it
  // for the case where it actually has a decay step to arm
  if (!isP) armFragmentDecayStep(f);
  fragments.push(f);
  // eviction past FRAGMENT_MAX_COUNT prefers dropping an ordinary (invisible)
  // fragment over a poison one - poison nuclides are drawn on screen and
  // compete with the player for neutrons (see updateFragments()), so they
  // shouldn't silently vanish just because the array filled up with
  // background decay flashes. A plain `if`, not `while`: this is the only
  // place fragments.push() happens, always one at a time, so the array can
  // only ever be one over the cap here
  if (fragments.length > FRAGMENT_MAX_COUNT) {
    let idx = fragments.findIndex((fr) => !fr.isPoison);
    if (idx === -1) idx = 0;
    fragments.splice(idx, 1);
  }
}

// radiation-type visual: color/length depend ONLY on which particle this
// decay mode emits, never on which nuclide emitted it - alpha is heavy and
// stops almost immediately (short/thick), beta-family (beta-minus or
// EC/beta+) is light and travels much further before losing energy
// (long/thin, same shape for both - only the color tells them apart, see
// decayParticleColor()). Gamma (IT) is neutral, not a charged particle at
// all, so it gets no line.
function decayTrailStyle(mode) {
  const kind = decayParticleKind(mode);
  if (!kind) return null;
  return { kind, color: decayParticleColor(kind) };
}

// one decay = one emitted radiation particle = one streak, flying off in a
// uniformly random direction (isotropic, like real radioactive emission) -
// reuses the same `particles` pool explosions/splashes draw from, just with
// p.trail/p.wave set so drawParticles() renders a streak/wave instead of a
// plain dot
function spawnDecayTrail(x, y, mode) {
  const style = decayTrailStyle(mode);
  if (!style) return;
  if (style.kind === "gamma") {
    spawnEMWave(x, y, GAMMA_COLOR);
    return;
  }
  const isAlpha = style.kind === "alpha";
  const angle = Math.random() * Math.PI * 2;
  const speed = isAlpha ? 70 + Math.random() * 50 : 190 + Math.random() * 90;
  const len = isAlpha ? 10 + Math.random() * 6 : 30 + Math.random() * 20;
  const width = isAlpha ? 3.5 + Math.random() : 1 + Math.random() * 0.5;
  const dur = isAlpha ? 0.2 + Math.random() * 0.1 : 0.35 + Math.random() * 0.2;
  particles.push({
    x, y,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    t: 0, dur, len, width, color: style.color, trail: true,
  });
}

// electromagnetic radiation (gamma/X-ray) visual: unlike a charged particle,
// which is drawn as a straight track (see spawnDecayTrail()'s p.trail case)
// that stops after a short distance, gamma/X-ray photons are waves, drawn as
// a sine curve oscillating perpendicular to their direction of travel (see
// drawParticles()'s p.wave branch for the actual "wipe" rendering). Every
// param past color is optional, defaulting to one fixed "highly penetrating"
// look (fast/long/long-lived) shared by gamma-family effects (plain decay
// gamma, the poison (n,γ) capture flash, and the paired annihilation
// photons) - none of those vary by nuclide, so there's nothing to randomize
// per-instance the way a charged particle's track does (whose length/speed/
// duration genuinely vary by radiation family, see spawnDecayTrail()).
// spawnCharacteristicXray() is the one caller that overrides these: a real
// X-ray's photon energy is lower than a nuclear gamma ray's, so it's tuned
// to read as slightly less "penetrating" than the shared default.
// angle defaults to a uniformly random direction (isotropic emission), but
// spawnAnnihilationEvent() passes an explicit angle for each half of its
// back-to-back photon pair, since momentum conservation requires them to
// point in exactly opposite directions, not just look independently similar
function spawnEMWave(x, y, color, angle, speed, len, dur, amplitude, waveCycles, width) {
  const a = angle !== undefined ? angle : Math.random() * Math.PI * 2;
  const sp = speed !== undefined ? speed : 480;
  particles.push({
    x, y,
    vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
    t: 0,
    dur: dur !== undefined ? dur : 0.8,
    len: len !== undefined ? len : 250,
    amplitude: amplitude !== undefined ? amplitude : 5,
    waveCycles: waveCycles !== undefined ? waveCycles : 12,
    width: width !== undefined ? width : 1.0,
    color, wave: true,
  });
}

// EC and beta+ don't look alike in real life, even though DECAY_MODE_EFFECT
// lumps them into one "ecBetaPlus" family (same dz/da): EC emits no charged
// particle at all (its actual signature is a characteristic X-ray from the
// atom's shell readjusting), while beta+ ejects a real positron that then
// meets an ambient electron and annihilates into two photons. This resolves
// which one actually happened for THIS decay and draws the right effect -
// used instead of spawnDecayTrail() for every EC/beta+-family mode.
function resolveECOrBetaPlusSubtype(mode) {
  // "EC+B+" is how the evaluated data records a branch where EC and beta+
  // compete for the same transition without a measured split between them -
  // every other EC/beta+-family mode already names its own mechanism
  if (mode === "EC+B+") return Math.random() < 0.5 ? "EC" : "B+";
  return mode.includes("EC") ? "EC" : "B+";
}
function spawnCharacteristicXray(x, y) {
  // slightly shorter/faster/shorter-lived than the shared gamma default -
  // a characteristic X-ray's own real photon energy is lower than a nuclear
  // gamma ray's, so it doesn't read as quite as "penetrating"
  spawnEMWave(
    x, y, CHARACTERISTIC_XRAY_COLOR,
    Math.random() * Math.PI * 2, // angle
    450, // speed
    220, // len
    0.75, // dur
    5, // amplitude
    10, // waveCycles
    1.0 // width
  );
}
function spawnBetaPlusTrail(x, y) {
  const angle = Math.random() * Math.PI * 2;
  const speed = 190 + Math.random() * 90;
  particles.push({
    x, y,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    t: 0, dur: 0.35 + Math.random() * 0.2, len: 30 + Math.random() * 20, width: 1 + Math.random() * 0.5,
    color: BETA_PLUS_COLOR, trail: true,
  });
}
// pair annihilation (対消滅): the emitted positron meets an ambient electron
// and both vanish into two photons flying in EXACTLY opposite directions -
// momentum conservation demands it, since the pair is ~at rest when this
// happens, so the two photon momenta must cancel to zero. Logged as a rare
// event (gold-glow log, same treatment as delayed-neutron emission) since
// it's the more visually/conceptually striking half of the EC/beta+ split.
function spawnAnnihilationEvent(f, mode) {
  const angle = Math.random() * Math.PI * 2;
  // same fixed speed spawnEMWave() itself now defaults to (see its own
  // comment) - passed explicitly here only because the back-to-back pair
  // needs to share one exact value, not because it's a different speed
  const speed = 480;
  spawnEMWave(f.x, f.y, ANNIHILATION_GAMMA_COLOR, angle, speed);
  spawnEMWave(f.x, f.y, ANNIHILATION_GAMMA_COLOR, angle + Math.PI, speed);
  logNuclearEvent(
    `💥${isotopeHTML(f.a, elementSymbolForZ(f.z))}のβ⁺が対消滅→消滅γ線2本発生！`,
    true, true
  );
  recordRareEvent(f.z, f.a, "annihilation", mode, f.pendingHalfLife, f.pendingRatio);
}
function spawnECOrBetaPlusEvent(f, mode) {
  if (resolveECOrBetaPlusSubtype(mode) === "EC") {
    spawnCharacteristicXray(f.x, f.y);
  } else {
    spawnBetaPlusTrail(f.x, f.y);
    spawnAnnihilationEvent(f, mode);
  }
}

function updateFragments(dt) {
  for (const f of fragments) {
    if (f.isPoison) {
      // slow side-to-side wobble (same wobbleAge convention as a floating
      // target - see spawnAndUpdateTargets()) so a poison nuclide reads as
      // "alive and worth watching", now that it's visible and matters for
      // gameplay, instead of an ordinary fragment's plain straight drift.
      // Random starting phase, also matching a fresh target's own wobbleAge,
      // so multiple poison nuclides appearing around the same moment don't
      // wobble in visible lockstep - divided by 3 to land in the same 0-2π
      // range the *3 below produces
      if (f.wobbleAge === undefined) f.wobbleAge = (Math.random() * Math.PI * 2) / 3;
      f.wobbleAge += dt;
      f.vx += Math.sin(f.wobbleAge * 3) * 35 * dt;
      f.poisonSpawnT += dt;
    }

    f.x += f.vx * dt;
    f.y += (f.vy + (f.isPoison ? POISON_FALL_SPEED : FRAGMENT_FALL_SPEED)) * dt;
    f.vx *= 0.94;
    f.vy *= 0.94;
    const minX = FIELD_X + FRAGMENT_WALL_MARGIN, maxX = FIELD_RIGHT - FRAGMENT_WALL_MARGIN;
    if (f.x < minX) { f.x = minX; f.vx = Math.abs(f.vx); }
    else if (f.x > maxX) { f.x = maxX; f.vx = -Math.abs(f.vx); }

    if (f.terminal) continue;

    // a fragment born as something else can decay INTO a poison nuclide -
    // armFragmentDecayStep() already catches the "poison from birth" case
    // (see spawnFragment()), so this only ever fires the first time a
    // fragment's chain happens to land on Xe-135/Sm-149 partway through
    if (isPoisonNuclide(f.z, f.a)) {
      f.isPoison = true;
      if (f.poisonSpawnT === undefined) f.poisonSpawnT = 0;
      if (!f.poisonLogged) {
        f.poisonLogged = true;
        const label = isotopeHTML(f.a, elementSymbolForZ(f.z));
        if (f.poisonSource && f.poisonSource.fromFission) {
          logNuclearEvent(`😋核分裂反応により${label}が生成！`, true, true);
        } else {
          const parentSym = (f.poisonSource && f.poisonSource.parentSym) || "親核種";
          const decayLabel = (f.poisonSource && f.poisonSource.decayModeLabel) || "壊変";
          logNuclearEvent(`😋${parentSym}の${decayLabel}壊変により${label}が生成！`, true, true);
        }
      }
    }

    // poisoned: the decay chain is frozen until it captures a neutron (see
    // the (n,γ) loop below), so there's no pendingMode countdown to step
    if (f.isPoison) continue;

    f.stepT += dt;
    if (f.stepT < f.stepDur) continue;

    const mode = f.pendingMode;
    const effect = DECAY_MODE_EFFECT[mode];
    // EC/beta+-family modes get their own split visual (X-ray vs positron
    // trail + annihilation) instead of the generic single-color track - see
    // spawnECOrBetaPlusEvent(). Bare proton emission ("P"/"2P") shares the
    // same dz<0 "ecBetaPlus" bucket for coloring purposes but isn't actually
    // EC or beta+, so it keeps the plain generic track.
    if (decayParticleKind(mode) === "ecBetaPlus" && mode !== "P" && mode !== "2P") {
      spawnECOrBetaPlusEvent(f, mode);
    } else {
      spawnDecayTrail(f.x, f.y, mode);
    }
    if (!effect || (effect.dz === 0 && effect.da === 0)) {
      f.terminal = effect ? "IT" : "unknown";
      continue;
    }
    // delayed-neutron precursor: this decay is immediately followed by a
    // real neutron emission, so it actually ejects a live neutron bullet
    // that can go on to trigger more fission - rendered white (see
    // drawBullets()) but otherwise moving/colliding exactly like any other
    // neutron. The same mechanic that makes real reactors controllable
    // despite fission itself being over in femtoseconds (see
    // DELAYED_NEUTRON_MODES's own comment above)
    if (DELAYED_NEUTRON_MODES.has(mode)) {
      const nAngle = Math.random() * Math.PI * 2;
      // real delayed neutrons carry much less kinetic energy than prompt
      // fission neutrons (~0.3-0.6MeV vs ~2MeV) - slower than
      // spawnFissionNeutrons()'s 230-370 range, but well above
      // NEUTRON_MIN_SPEED (40, the fully-thermalized floor): this is a
      // genuinely slow-but-still-fast neutron, not a thermal one
      const nSpeed = 110 + Math.random() * 80;
      bullets.push({
        x: f.x, y: f.y,
        vx: Math.cos(nAngle) * nSpeed, vy: Math.sin(nAngle) * nSpeed,
        gen: f.gen, speed0: nSpeed, distTraveled: 0,
        white: true,
      });
      totalFissionNeutrons++;
      // delayed-neutron emission is a rare event (only a handful of very
      // neutron-rich fragments have a precursor step at all, and it's just
      // one step out of their whole decay chain) - always logged, unlike the
      // fission/absorption events above which only log on a learning shot,
      // so it stands out whenever it happens instead of blending in
      logNuclearEvent(
        `🔑${delayedNeutronHalfLifeLabel(f.pendingHalfLife)}${isotopeHTML(f.a, elementSymbolForZ(f.z))}から遅発中性子が発生！`,
        true, true
      );
      recordRareEvent(f.z, f.a, "delayedNeutron", mode, f.pendingHalfLife, f.pendingRatio);
    }

    // captured before z/a change below - only needed if this step happens
    // to land on a poison nuclide (see just below)
    const parentSym = elementSymbolForZ(f.z);
    const decayModeLabel = effect.label || mode;

    f.z += effect.dz;
    f.a += effect.da;
    f.stepsDone++;

    if (isPoisonNuclide(f.z, f.a)) {
      f.isPoison = true;
      f.poisonSpawnT = 0;
      if (!f.poisonSource) f.poisonSource = { fromFission: false, parentSym, decayModeLabel };
    }

    if (f.stepsDone >= DECAY_CHAIN_MAX_STEPS) f.terminal = "maxDepth";
    else armFragmentDecayStep(f);
  }

  // (n,γ) neutron capture on a poison nuclide: the same speed-dependent
  // reaction-probability curve as any other capture (reactionProbability())
  // decides whether a passing neutron actually reacts or just scatters off -
  // a still-fast neutron usually isn't absorbed. A capture consumes the
  // neutron (same b.absorbed flag/cleanup as the 吸収体 item - see
  // updateBulletPhysics()), bumps A by 1 (Xe135->Xe136, Sm149->Sm150 - both
  // comfortably non-poison), flashes a gamma ray, and resumes the fragment's
  // decay chain from its new, no-longer-poisoned nuclide
  for (const f of fragments) {
    if (!f.isPoison || f.terminal) continue;
    for (const b of bullets) {
      if (b.absorbed) continue;
      const dx = b.x - f.x, dy = b.y - f.y;
      if (dx * dx + dy * dy >= 16 * 16) continue;
      const bulletSpeed = Math.hypot(b.vx, b.vy);
      const prob = reactionProbability(bulletSpeed, FAST_REACTION_CHANCE_FISSION);
      if (!b.guaranteedReaction && Math.random() >= prob) {
        scatterBullet(b);
        if (b.learning) {
          logNuclearEvent(
            `${isotopeHTML(f.a, elementSymbolForZ(f.z))}で中性子が散乱：速い中性子は吸収されにくい`,
            true, true
          );
        }
        continue;
      }

      b.absorbed = true;
      const oldA = f.a;
      const sym = elementSymbolForZ(f.z);
      f.a += 1;
      f.isPoison = false;
      spawnEMWave(f.x, f.y, GAMMA_COLOR);
      recordObtainedElement(f.z, sym, f.a);
      score += awardNeutronScore(CAPTURE_POISON_SCORE_BASE, b.gen);
      if (b.learning) {
        logNuclearEvent(
          `⚛️中性子吸収！ ${isotopeHTML(oldA, sym)}が中性子を吸収してγ線を放出した`,
          true, true
        );
      }
      armFragmentDecayStep(f);
      break;
    }
  }

  // once terminal (stable/unknown/IT/maxDepth) a fragment has nothing left
  // to do - it's invisible, so there's nothing to fade, just drop it
  fragments = fragments.filter((f) => f.y < FIELD_BOTTOM + 20 && !f.terminal);
}

// ---- decay-chain diagram & periodic-table panel (game-over screen) ----
// dark ink reads at >=4.2:1 against all four node colors above (verified by
// hand against COLORS.u235/pu/u238/b10 - none of them are dark/saturated
// enough to need white text, unlike some PERIODIC_CATEGORY_STYLE families)
const DECAY_NODE_TEXT_COLOR = "#0b0b0b";

const DECAY_NODE_R = 17;
const DECAY_NODE_PITCH_MAX = 70;
// each page of the level-2 diagram shows at most this many nodes - matches
// the pitch/size already proven comfortable (9*70=560px against PT_PANEL's
// ~576px usable width). Chains longer than this (common now that
// DECAY_CHAIN_MAX_STEPS grew to 16 for U235/U238/Np239/Pu239's real natural
// decay series) paginate instead of cramming everything into one page - see
// ptChainTotalPages()/ptChainPageSteps() for how pages are split, and
// ptChainPageSteps()'s own comment for the "last node of page N reappears as
// page N+1's first node" carry-over format.
const DECAY_CHAIN_NODES_PER_PAGE = 9;
function ptChainTotalPages() {
  if (!ptChainSteps) return 1;
  const n = ptChainSteps.length;
  if (n <= DECAY_CHAIN_NODES_PER_PAGE) return 1;
  return Math.ceil((n - 1) / (DECAY_CHAIN_NODES_PER_PAGE - 1));
}
// page 0 shows nodes [0..8] (9 nodes, 8 arrows) same as before pagination
// existed; page 1+ each start by repeating the previous page's LAST node (so
// the chain visually keeps flowing instead of just resuming with no
// context), then continue with up to 8 new nodes after it. Only the true
// last node of the true last page ever carries a `.terminal` (walkDecayChain()
// only sets it on the chain's real final element), so mid-chain carry-over
// nodes naturally render as ordinary (non-terminal) nodes with no extra logic.
function ptChainPageSteps() {
  const perPage = DECAY_CHAIN_NODES_PER_PAGE;
  const startIdx = ptChainPage === 0 ? 0 : ptChainPage * (perPage - 1);
  return ptChainSteps.slice(startIdx, startIdx + perPage);
}
// bottom strip of the panel, split left/right - tapped while browsing level
// 2 to page back/forth (only live when ptChainTotalPages() > 1), same
// convention as ptRarePageZone()
function ptChainPageZone() {
  const y0 = PT_PANEL.y + 165, y1 = PT_PANEL.y + PT_PANEL.h - 4;
  const midX = PT_PANEL.x + PT_PANEL.w / 2;
  return {
    prev: { x0: PT_PANEL.x + 10, x1: midX - 10, y0, y1 },
    next: { x0: midX + 10, x1: PT_PANEL.x + PT_PANEL.w - 10, y0, y1 },
  };
}
function decayNodeLayout(n) {
  const areaX0 = PT_PANEL.x + 24, areaX1 = PT_PANEL.x + PT_PANEL.w - 24;
  const pitch = n > 1 ? Math.min(DECAY_NODE_PITCH_MAX, (areaX1 - areaX0) / (n - 1)) : 0;
  const totalW = pitch * (n - 1);
  return { pitch, startX: PT_PANEL.x + PT_PANEL.w / 2 - totalW / 2, y: PT_PANEL.y + 107, r: DECAY_NODE_R };
}
function decayNodeX(layout, i) {
  return layout.startX + i * layout.pitch;
}

// short caption below the diagram: how the chain ended, plus the "★" legend
// (only shown when this particular chain actually has a precursor in it -
// color/glyph alone shouldn't carry the meaning, see the accessibility note
// this replaced from the previous text-only version). `pageSteps` is just
// the current page's slice (see ptChainPageSteps()) - `isLastPage` decides
// whether `pageSteps`'s own last node's `.terminal` is the chain's real
// ending or just a mid-chain carry-over into the next page (which never
// carries a `.terminal` itself, but the caption still shouldn't go quiet
// there - "続く" beats no feedback at all while more pages remain)
function decayChainCaption(pageSteps, isLastPage) {
  const last = pageSteps[pageSteps.length - 1];
  const parts = [];
  if (!isLastPage) parts.push("次のページに続く");
  // "stable" gets no caption - the green terminal circle already says that on
  // its own (see decayNodeColor()); the other three endings all render as the
  // same gold circle, so they still need the text to tell them apart
  else if (last.terminal === "IT") parts.push("γ線放出");
  else if (last.terminal === "maxDepth") parts.push("以降も壊変が続く");
  else if (last.terminal === "unknown") parts.push("データなし");
  if (pageSteps.some((s) => s.mode && DELAYED_NEUTRON_MODES.has(s.mode))) {
    parts.push(`<span style="color:${DELAYED_NEUTRON_COLOR};font-weight:bold">★＝遅発中性子先行核</span>`);
  }
  return parts.join("　");
}

// canvas half of the level-2 diagram (circles + connecting arrows); the
// isotope/mode/half-life labels themselves are DOM text positioned by
// syncPeriodicTableDOM() at these same coordinates, same split as everywhere
// else text is drawn on top of canvas shapes in this game
function drawDecayChainDiagram(steps) {
  const layout = decayNodeLayout(steps.length);
  for (let i = 0; i < steps.length - 1; i++) {
    const x0 = decayNodeX(layout, i) + layout.r, x1 = decayNodeX(layout, i + 1) - layout.r;
    const color = decayNodeColor(steps[i]);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x0, layout.y);
    ctx.lineTo(x1, layout.y);
    ctx.stroke();
    const headLen = 6;
    ctx.beginPath();
    ctx.moveTo(x1, layout.y);
    ctx.lineTo(x1 - headLen, layout.y - headLen * 0.6);
    ctx.lineTo(x1 - headLen, layout.y + headLen * 0.6);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }
  for (let i = 0; i < steps.length; i++) {
    const cx = decayNodeX(layout, i), cy = layout.y, r = layout.r;
    const color = decayNodeColor(steps[i]);
    const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.15, cx, cy, r);
    grad.addColorStop(0, lighten(color, 0.4));
    grad.addColorStop(1, color);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.stroke();
    if (steps[i].mode && DELAYED_NEUTRON_MODES.has(steps[i].mode)) {
      // sits mostly OUTSIDE the circle's own edge (0.78 * r*sqrt(2) > r) so it
      // reads as a badge against the panel background rather than blending
      // into the circle's own fill - a 0.68 offset (badge center inside the
      // circle) measured nearly invisible at this canvas scale
      drawStar(cx + r * 0.78, cy - r * 0.78, 8, 3.5, 5, -Math.PI / 2, DELAYED_NEUTRON_COLOR);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    }
  }
}

// rainbow-ordered family colors (red -> orange -> yellow -> green -> aqua ->
// blue -> violet -> magenta) - each bg/text pairing was picked for readable
// contrast (WCAG >= ~4.4:1 at minimum, most well above), so no combination
// ends up low-contrast-on-light (e.g. yellow+white) the way a naive rainbow
// fill would
const PERIODIC_CATEGORY_STYLE = {
  alkali: { bg: "#e34948", text: "#0b0b0b" },
  alkalineEarth: { bg: "#eb6834", text: "#0b0b0b" },
  transition: { bg: "#eda100", text: "#0b0b0b" },
  postTransition: { bg: "#008300", text: "#ffffff" },
  metalloid: { bg: "#1baf7a", text: "#0b0b0b" },
  reactive: { bg: "#2a78d6", text: "#ffffff" },
  nobleGas: { bg: "#4a3aa7", text: "#ffffff" },
  lanthanide: { bg: "#e87ba4", text: "#0b0b0b" },
  // a deeper violet than lanthanide's pink - distinct at a glance despite
  // sitting right below it (Nd/Pm/Sm), while still reading as "the same
  // f-block family" rather than an unrelated color
  actinide: { bg: "#8b3a9e", text: "#ffffff" },
};

// the panel is stretched to nearly the full canvas width (small touch
// targets on iPhone were hard to tap - see the discussion this grew out of),
// with every other dimension below scaled by the same PT_SCALE factor so the
// grid's proportions (and the ~4px edge slack the original numbers had) stay
// consistent instead of drifting. positionGameOverOverlay()/syncGameOverDOM()/
// drawGameOver() shift the score card up by GAMEOVER_CARD_CY (see below) to
// make room for the taller panel underneath it.
const PT_SCALE = 1.1;
// x/w pushed to within 8px of each canvas edge, and the column pitch/cell
// width widened to actually use that space (the original numbers left ~30px
// of unused margin on the right - column width is what was cramped, not the
// panel itself). Row height (PT_ROW_PITCH/PT_CELL_H) was later grown too, to
// fit a second, smaller "×N" obtained-count line under each element symbol -
// see GAMEOVER_CARD_CY below for where that extra height came from.
const PT_PANEL = { x: 8, y: 283, w: 624, h: 185 };
const PT_COL_PITCH = 34, PT_ROW_PITCH = 34;
const PT_CELL_W = 31, PT_CELL_H = 30;
const PT_GRID_LEFT = PT_PANEL.x + 7;
const PT_GRID_TOP = PT_PANEL.y + 31;
function ptCellX(col) {
  return PT_GRID_LEFT + (col - 1) * PT_COL_PITCH;
}
// per-row Y offsets (relative to PT_GRID_TOP) - NOT a uniform row*PT_ROW_PITCH
// below row 2, since rows 2/3/4 need uneven gaps rather than a full pitch
// each: Cs/Ba (row 2) and the lanthanides (row 3) share no columns, so a
// small 14px nudge is enough to read as "a separate row" without spending a
// full pitch on it; the lanthanides and actinides (row 4) DO share columns
// (U/Np/Pu sit directly under Nd/Pm/Sm), so that gap needs at least a full
// cell height (PT_CELL_H) plus a couple px of breathing room, or the two
// rows would visually overlap in those shared columns
const PT_ROW_Y = [0, PT_ROW_PITCH, PT_ROW_PITCH * 2, PT_ROW_PITCH * 2 + 14, PT_ROW_PITCH * 2 + 14 + PT_CELL_H + 2];
function ptCellY(row) {
  return PT_GRID_TOP + PT_ROW_Y[row];
}

// isotope-chip row layout for drill level 1 (an obtained element's isotopes) -
// centered horizontally within the panel, evenly spaced, capped at PT_CHIP_MAX
// so an element with an unusually long isotope list doesn't overflow the panel
const PT_CHIP_MAX = 10;
// ptRareMode's list layout: two side-by-side mini-tables (own dedicated DOM
// pools, not shared with the level-1 isotope chips - a bigger cap here
// shouldn't make those chips any more cramped), each with its own "核種/反応
// 半減期 分岐比" column header and PT_RARE_ROWS_MAX data rows below it. A
// plain table beats one long sentence per row (the previous design) - the
// half-life/ratio values line up in their own column instead of every row
// re-spelling "半減期"/a comma, so there's less to read per row and columns
// of numbers become easy to scan/compare at a glance. Anything beyond one
// page's PT_RARE_COLS*PT_RARE_ROWS_MAX capacity spills onto additional pages
// (see ptRareTotalPages()/ptRarePage).
const PT_RARE_COLS = 2;
// 5, not 6: the extra column-header row above the data rows eats into the
// same vertical budget the old header-less list had, so one fewer data row
// per table keeps everything inside the panel without shrinking font sizes
const PT_RARE_ROWS_MAX = 5;
const PT_RARE_TABLE_HEADER_Y = PT_PANEL.y + 40;
const PT_RARE_ROW_START_Y = PT_PANEL.y + 56;
const PT_RARE_ROW_H = 20;
// left edge of table block `col` (0 or 1) - subcolumns within it are placed
// at fixed offsets from this, left-aligned (not the "center" class the rest
// of the panel's text uses), so every row's half-life/ratio values start at
// the same x regardless of how many digits they run to
function ptRareBlockX0(col) {
  // gap >> margin, deliberately: a wide gutter down the panel's own middle
  // reads as "two separate tables" far more clearly than the same amount of
  // whitespace spent padding out each table's own internal columns would
  const margin = 14, gap = 44;
  const blockW = (PT_PANEL.w - margin * 2 - gap * (PT_RARE_COLS - 1)) / PT_RARE_COLS;
  return PT_PANEL.x + margin + col * (blockW + gap);
}
// [nuclide+mode, half-life, ratio] offsets from a block's own x0 - snug
// against the longest realistic cell in each (e.g. "⁸¹Nb β⁻+2n", "1.25×10⁹年",
// "7.0×10⁻¹%") rather than left with slack, so the columns *within* one
// table read as tightly related and the gap *between* the two tables (see
// ptRareBlockX0()) stands out as the real dividing line
const PT_RARE_SUBCOL_X = [6, 128, 198];
const PT_RARE_HEADER_LABELS = ["核種/反応", "半減期", "分岐比"];
function ptRareTotalPages() {
  return Math.max(1, Math.ceil(rareEventLog.length / (PT_RARE_COLS * PT_RARE_ROWS_MAX)));
}
// bottom strip of the panel, split left/right - tapped while browsing the
// rare-event log to page back/forward (only live when ptRareTotalPages() > 1)
function ptRarePageZone() {
  const y0 = PT_RARE_ROW_START_Y + PT_RARE_ROWS_MAX * PT_RARE_ROW_H;
  const y1 = PT_PANEL.y + PT_PANEL.h - 4;
  const midX = PT_PANEL.x + PT_PANEL.w / 2;
  return {
    prev: { x0: PT_PANEL.x + 10, x1: midX - 10, y0, y1 },
    next: { x0: midX + 10, x1: PT_PANEL.x + PT_PANEL.w - 10, y0, y1 },
  };
}
function ptChipRect(index, count) {
  const areaX0 = PT_PANEL.x + 18, areaX1 = PT_PANEL.x + PT_PANEL.w - 18;
  const gap = 7;
  const chipW = Math.min(56, (areaX1 - areaX0 - (count - 1) * gap) / count);
  const totalW = count * chipW + (count - 1) * gap;
  const startX = PT_PANEL.x + PT_PANEL.w / 2 - totalW / 2;
  // taller than before (was 37) to fit a second, smaller "×N個" count line
  // under the isotope label (see syncPeriodicTableDOM()) - PT_PANEL grew to
  // make room for this too, see the PT_SCALE comment above its declaration
  return { x: startX + index * (chipW + gap), y: PT_PANEL.y + 60, w: chipW, h: 55 };
}

// hit-testing for the touch drill-down (see handleTouchStartGameOver())
// - geometry mirrors what drawPeriodicTablePanel() actually draws,
// grown by a couple px of invisible padding on every side (same "hit zone
// bigger than the visual" idea as gameOverCloseButtonZone()) since the cells
// are still small enough on a phone screen that a pixel-perfect tap is
// unreasonable to demand; the pitch's ~4px cell gap keeps neighboring cells'
// padded zones from overlapping
// the wider columns above left only a 3px gap between cells (was 4px), so
// the padding shrinks to 1px to avoid two neighboring cells' padded zones overlapping
const PT_HIT_PAD = 1;
function ptElementIndexAt(x, y) {
  for (let i = 0; i < PERIODIC_OBTAINABLE_ELEMENTS.length; i++) {
    const el = PERIODIC_OBTAINABLE_ELEMENTS[i];
    const cx = ptCellX(el.col), cy = ptCellY(el.row);
    if (x >= cx - PT_HIT_PAD && x <= cx + PT_CELL_W + PT_HIT_PAD && y >= cy - PT_HIT_PAD && y <= cy + PT_CELL_H + PT_HIT_PAD) return i;
  }
  return -1;
}
// the periodic-table grid's top-left cell (K's spot, row 0 col 1 - a real
// element but below PERIODIC_OBTAINABLE_MIN_Z, so never selectable as a
// fission product) is otherwise permanently inert decoration - repurposed as
// the entry point into ptRareMode (see its own comment) instead of adding
// any new screen space, since there's essentially none left below PT_PANEL
function ptRareEntryZone() {
  return { x0: ptCellX(1), x1: ptCellX(1) + PT_CELL_W, y0: ptCellY(0), y1: ptCellY(0) + PT_CELL_H };
}
function ptIsotopeIndexAt(x, y) {
  const count = Math.min(PT_CHIP_MAX, ptIsotopeList.length);
  for (let i = 0; i < count; i++) {
    const r = ptChipRect(i, count);
    if (x >= r.x - PT_HIT_PAD && x <= r.x + r.w + PT_HIT_PAD && y >= r.y - PT_HIT_PAD && y <= r.y + r.h + PT_HIT_PAD) return i;
  }
  return -1;
}

// keyboard/gamepad cursor movement within whichever level of the decay-chain
// browser is currently open (level 2 has nothing to navigate - one chain, no list)
function ptNavigate(dir) {
  if (ptDrillLevel === 0) {
    const n = PERIODIC_OBTAINABLE_ELEMENTS.length;
    // -1 = the rare-event-log entry cell (see ptRareEntryZone()/ptDrillConfirm()),
    // folded into the same flat left/right cycle as an extra stop rather than
    // a separate control - it sits at the grid's spatial top-left, so
    // wrapping past either end of the element cycle naturally reaches it too
    ptCursorZIndex = ((ptCursorZIndex + 1) + dir + (n + 1)) % (n + 1) - 1;
  } else if (ptDrillLevel === 1 && ptIsotopeList.length > 0) {
    const n = Math.min(PT_CHIP_MAX, ptIsotopeList.length);
    ptIsotopeIndex = (ptIsotopeIndex + dir + n) % n;
  }
}
// vertical cursor movement across the element grid (level 0 only - the
// isotope chip row at level 1 is a single line, so up/down has no meaning
// there). Moves to the nearest-column element in the next row that direction,
// mirroring how a real periodic table's shape reads (period 4 -> period 5 ->
// period 6 -> the lanthanide footnote row), wrapping past either end.
function ptNavigateVertical(dir) {
  if (ptDrillLevel !== 0) return;
  // the rare-entry cell (ptCursorZIndex === -1) has no row of its own in
  // PERIODIC_OBTAINABLE_ELEMENTS - stand in a virtual position (row -1,
  // col 1, matching where it's actually drawn) so this doesn't throw; it
  // just falls through to whichever row ends up nearest, same as any other
  // out-of-range starting point would
  const cur = ptCursorZIndex === -1 ? { row: -1, col: 1 } : PERIODIC_OBTAINABLE_ELEMENTS[ptCursorZIndex];
  // the rare-entry cell is drawn directly above Rb (row 0 col 1 vs. Rb's row
  // 1 col 1) - move straight between the two instead of falling through to
  // the column search below, which would land on Cs (row 2, also col 1) instead
  if (dir < 0 && cur.row === 1 && cur.col === 1) { ptCursorZIndex = -1; return; }
  if (dir > 0 && cur.row === -1) { ptCursorZIndex = PERIODIC_OBTAINABLE_ELEMENTS.findIndex((e) => e.z === 37); return; }
  const rows = [...new Set(PERIODIC_OBTAINABLE_ELEMENTS.map((e) => e.row))].sort((a, b) => a - b);
  const curRowPos = rows.indexOf(cur.row);
  const rowCount = rows.length;
  // walk rows one at a time in the requested direction, wrapping past either
  // end, looking for the first row that has a cell in the SAME column as the
  // cursor - e.g. Pr (row 3 lanthanide footnote, col 5) moving up steps past
  // row 2 (Cs/Ba only, no col 5) and lands on Nb (row 1, col 5), the same way
  // a real periodic table's groups read straight down through the
  // lanthanide/actinide footnote rows instead of just snapping to whatever's
  // spatially nearest in the very next row
  for (let step = 1; step < rowCount; step++) {
    const targetRow = rows[(((curRowPos + step * dir) % rowCount) + rowCount) % rowCount];
    const exact = PERIODIC_OBTAINABLE_ELEMENTS.find((e) => e.row === targetRow && e.col === cur.col);
    if (exact) { ptCursorZIndex = PERIODIC_OBTAINABLE_ELEMENTS.indexOf(exact); return; }
  }
  // no row anywhere shares this exact column (not reachable with the current
  // element set, since row 1 alone spans every column 1-18 in use, but kept
  // as a safety net) - fall back to nearest-column in the immediately
  // adjacent row
  const closestInRow = (row) => {
    const candidates = PERIODIC_OBTAINABLE_ELEMENTS.filter((e) => e.row === row);
    let best = candidates[0];
    for (const e of candidates) {
      if (Math.abs(e.col - cur.col) < Math.abs(best.col - cur.col)) best = e;
    }
    return best;
  };
  let targetRow = rows[curRowPos + dir];
  if (targetRow === undefined) targetRow = dir > 0 ? rows[0] : rows[rows.length - 1]; // wrap past either end
  ptCursorZIndex = PERIODIC_OBTAINABLE_ELEMENTS.indexOf(closestInRow(targetRow));
}
// drills one level deeper (element -> its obtained isotopes -> that isotope's
// decay chain), wrapping from the chain view back to the top-level grid -
// shared by the keyboard/gamepad Shift+shoot confirm and touch's direct taps
function ptDrillConfirm() {
  // the level about to change, so whatever cell/chip the mouse was hovering
  // at the old level no longer means anything at the new one (see
  // updatePtMouseHover() - it'll recompute on the next mousemove regardless)
  ptMouseHoverIdx = -1;
  ptMouseHoverIsotopeIdx = -1;
  ptMouseHoverRareEntry = false;
  if (ptDrillLevel === 0) {
    if (ptCursorZIndex === -1) { ptRareMode = true; ptRarePage = 0; return; } // the rare-entry cell - see ptNavigate()
    const el = PERIODIC_OBTAINABLE_ELEMENTS[ptCursorZIndex];
    const entry = obtainedElements.get(el.z);
    if (!entry || entry.isotopes.size === 0) return; // nothing obtained yet for this cell
    ptIsotopeList = [...entry.isotopes.keys()].sort((a, b) => a - b);
    ptIsotopeIndex = 0;
    ptDrillLevel = 1;
  } else if (ptDrillLevel === 1) {
    const el = PERIODIC_OBTAINABLE_ELEMENTS[ptCursorZIndex];
    ptChainSteps = walkDecayChain(el.z, ptIsotopeList[ptIsotopeIndex]);
    ptChainPage = 0;
    ptDrillLevel = 2;
  } else {
    ptDrillLevel = 0;
    ptChainSteps = null;
  }
}

// text content lives in #gameOverOverlay (see syncPeriodicTableDOM()) - this
// draws the panel's background plus whatever level of the decay-chain
// browser (drill level 0/1/2) is currently open: the periodic-table grid
// itself, a row of isotope chips for one selected element, or (level 2) the
// circle-and-arrow decay diagram (see drawDecayChainDiagram())
function drawPeriodicTablePanel() {
  drawCard(PT_PANEL.x, PT_PANEL.y, PT_PANEL.w, PT_PANEL.h);
  // ptRareMode's content is plain DOM text rows (see syncPeriodicTableDOM())
  // - nothing else to draw on the canvas beyond the card background above
  if (ptRareMode) return;
  if (ptDrillLevel === 0) {
    for (const el of PERIODIC_ELEMENTS) {
      const x = ptCellX(el.col), y = ptCellY(el.row);
      const obtained = obtainedElements.has(el.z);
      const isSpacer = el.z < PERIODIC_OBTAINABLE_MIN_Z;
      roundRectPath(x, y, PT_CELL_W, PT_CELL_H, 4);
      if (isSpacer) {
        ctx.fillStyle = "rgba(58,47,107,0.05)";
      } else {
        const style = PERIODIC_CATEGORY_STYLE[el.cat];
        ctx.fillStyle = style.bg + (obtained ? "" : "2b"); // ~17% alpha when not yet obtained
      }
      ctx.fill();
    }
    // keyboard/gamepad cursor (Shift/shoulder + left/right moves this) -
    // touch selects a cell directly by tapping it, so it never needs a
    // cursor box. Hidden until Shift/shoulder is actually held (ptCursorActive)
    // - showing it beforehand would suggest arrow keys already do something,
    // when they don't until the modifier is held (see ptHintEl's
    // "Shiftを押し続けて選択" prompt in that state instead). Mouse instead
    // gets a hover box (ptMouseHoverIdx, see updatePtMouseHover()): unlike
    // touch it has a real hover state, so the box can track the cursor
    // continuously instead of only appearing after a click already happened
    // boxIdx's own "nothing selected" sentinel is `undefined`, not -1: -1 is
    // a legitimate value (the keyboard/gamepad cursor - or a mouse hover,
    // via ptMouseHoverRareEntry - sitting on the rare-entry cell, see
    // ptNavigate()) that still needs its box drawn. ptMouseHoverIdx keeps
    // its own separate -1-means-nothing convention untouched
    const boxIdx = !pointsDirectly() && ptCursorActive ? ptCursorZIndex
      : lastInputDevice === "mouse" && ptMouseHoverIdx !== -1 ? ptMouseHoverIdx
      : lastInputDevice === "mouse" && ptMouseHoverRareEntry ? -1
      : undefined;
    if (boxIdx !== undefined) {
      const x = boxIdx === -1 ? ptCellX(1) : ptCellX(PERIODIC_OBTAINABLE_ELEMENTS[boxIdx].col);
      const y = boxIdx === -1 ? ptCellY(0) : ptCellY(PERIODIC_OBTAINABLE_ELEMENTS[boxIdx].row);
      roundRectPath(x - 2, y - 2, PT_CELL_W + 4, PT_CELL_H + 4, 5);
      ctx.save();
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  } else if (ptDrillLevel === 1) {
    const el = PERIODIC_OBTAINABLE_ELEMENTS[ptCursorZIndex];
    const style = PERIODIC_CATEGORY_STYLE[el.cat];
    const count = Math.min(PT_CHIP_MAX, ptIsotopeList.length);
    for (let i = 0; i < count; i++) {
      const r = ptChipRect(i, count);
      const selected = (!pointsDirectly() && ptCursorActive && i === ptIsotopeIndex)
        || (lastInputDevice === "mouse" && i === ptMouseHoverIsotopeIdx);
      roundRectPath(r.x, r.y, r.w, r.h, 6);
      ctx.fillStyle = selected ? style.bg : style.bg + "55";
      ctx.fill();
    }
  } else if (ptDrillLevel === 2 && ptChainSteps) {
    drawDecayChainDiagram(ptChainPageSteps());
  }
}

// ---- game-over screen text, rendered as DOM overlay (see the HUD overlay
// near the top of this file for the same technique + rationale) ----
const gameOverOverlayEl = document.getElementById("gameOverOverlay");

const goScoreLabelEl = makeHudTextEl(gameOverOverlayEl, "center");
goScoreLabelEl.textContent = "スコア";
goScoreLabelEl.style.color = COLORS.pu;
const goScoreValueEl = makeHudTextEl(gameOverOverlayEl, "center");
const goChainMaxEl = makeHudTextEl(gameOverOverlayEl, "center");
const goRankMsgEl = makeHudTextEl(gameOverOverlayEl, "center");
const goRestartHintEl = makeHudTextEl(gameOverOverlayEl, "center");

// touch/mouse-only "×" close button (top-right corner, see gameOverCloseButtonZone())
// - a tap/click returns to the title screen. only shown for pointsDirectly()
// devices, since keyboard/gamepad already have their own restart hint and
// this would just be visual noise for them. white on the solid red circle
// drawGameOver() draws behind it, for strong "this closes the screen" contrast
const goCloseButtonEl = makeHudTextEl(gameOverOverlayEl, "center");
goCloseButtonEl.textContent = "×";
goCloseButtonEl.style.color = "#ffffff";

// periodic-table panel: a header (with a live "N/48種類" tally) plus one
// small symbol label per real element (spacer cells stay textless)
const ptHeaderEl = makeHudTextEl(gameOverOverlayEl, "center");
ptHeaderEl.style.color = COLORS.pu;
// level-0-only operation hint, right-aligned against the header on the same
// row (translateX(-100%) so it stays flush to the panel's right edge
// regardless of how long the current device's message is - see
// ptOperationHint() for the text itself) - explains how to drive the
// keyboard/gamepad cursor before the player has found the Shift/shoulder
// modifier (see ptCursorActive), then switches to the deeper-drill
// instruction once they have; touch/mouse never need the modifier, so they
// just get the plain tap/click hint
const ptHintEl = makeHudTextEl(gameOverOverlayEl);
ptHintEl.style.color = "rgba(58,47,107,0.55)";
ptHintEl.style.transform = "translateX(-100%)";
const ptElementEls = PERIODIC_ELEMENTS.map(() => makeHudTextEl(gameOverOverlayEl, "center"));
// magnifying-glass hint over the grid's K cell (otherwise permanently inert,
// see ptRareEntryZone()) - the only visual cue that tapping/selecting it
// opens the rare-event log, so it only shows at level 0 while not already in
// that mode (see syncPeriodicTableDOM())
const ptRareEntryIconEl = makeHudTextEl(gameOverOverlayEl, "center");
// decay-chain browser overlays for drill levels 1 (isotope chips) and 2 (the
// walked chain itself) - positioned per-frame in syncPeriodicTableDOM() since
// their layout depends on the currently-drilled-into element/isotope, unlike
// the level-0 grid labels above which sit at fixed positions set once here
const ptChipEls = Array.from({ length: PT_CHIP_MAX }, () => makeHudTextEl(gameOverOverlayEl, "center"));
// level 2's isotope label (one per circle) and mode/half-life label (one per
// arrow) pools, sized to one page's worst case (DECAY_CHAIN_NODES_PER_PAGE
// nodes, one fewer arrows) - NOT DECAY_CHAIN_MAX_STEPS, since pagination
// means a page never actually shows the whole (possibly much longer) chain
const ptDecayNodeEls = Array.from({ length: DECAY_CHAIN_NODES_PER_PAGE }, () => makeHudTextEl(gameOverOverlayEl, "center"));
const ptDecayArrowEls = Array.from({ length: DECAY_CHAIN_NODES_PER_PAGE - 1 }, () => makeHudTextEl(gameOverOverlayEl, "center"));
// now doubles as level 2's short caption line (how the chain ended, plus the
// "★" legend when relevant) - see decayChainCaption()
const ptChainTextEl = makeHudTextEl(gameOverOverlayEl, "center wrap");
// level 2's own "‹ page / total ›" indicator, doubling as the tap target
// for ptChainPageZone() - same convention as ptRarePageEl
const ptChainPageEl = makeHudTextEl(gameOverOverlayEl, "center");
// ptRareMode's table (see PT_RARE_COLS/PT_RARE_ROWS_MAX/PT_RARE_SUBCOL_X) -
// fixed grid positions set once below, only text content changes per page
// (see syncPeriodicTableDOM()). Left-aligned (no "center" class - unlike
// every other panel label), since a table's columns need to start at the
// same x on every row regardless of how wide each value is, not be centered
// around it. Split into 3 pools (one per subcolumn) rather than one combined
// string per row, so each subcolumn can sit at its own fixed x.
const ptRareNuclideEls = Array.from({ length: PT_RARE_COLS * PT_RARE_ROWS_MAX }, () => makeHudTextEl(gameOverOverlayEl));
const ptRareHalfLifeEls = Array.from({ length: PT_RARE_COLS * PT_RARE_ROWS_MAX }, () => makeHudTextEl(gameOverOverlayEl));
const ptRareRatioEls = Array.from({ length: PT_RARE_COLS * PT_RARE_ROWS_MAX }, () => makeHudTextEl(gameOverOverlayEl));
// static "核種/反応 / 半減期 / 分岐比" column-label row, one set per table
// block - content never changes, only shown/hidden with ptRareMode (see
// syncPeriodicTableDOM())
const ptRareHeaderEls = Array.from({ length: PT_RARE_COLS * 3 }, () => makeHudTextEl(gameOverOverlayEl));
ptRareHeaderEls.forEach((el) => (el.style.color = "rgba(58,47,107,0.55)"));
// "‹ page / total ›" indicator, doubling as the tap target for ptRarePageZone()
const ptRarePageEl = makeHudTextEl(gameOverOverlayEl, "center");

// the score card sits above the periodic-table panel and is shifted up from
// true vertical center (GAME_H/2) to make room for PT_PANEL's taller,
// touch-friendlier size below it (and, on top of that, PT_PANEL grew taller
// again to fit the obtained-count line under each element) - see the
// PT_SCALE comment above PT_PANEL
const GAMEOVER_CARD_CY = 175;

function positionGameOverOverlay(scale) {
  const cx = GAME_W / 2, cy = GAMEOVER_CARD_CY;
  const cardH = 200;
  positionHudTextBaseline(goScoreLabelEl, cx, cy - cardH / 2 + 30, 20, scale);
  positionHudTextBaseline(goChainMaxEl, cx, cy + 38, 14, scale);
  positionHudTextBaseline(goRestartHintEl, cx, cy + cardH / 2 - 12, 14, scale);
  // goScoreValueEl's and goRankMsgEl's font sizes depend on their (content-
  // dependent) text width, so they're positioned per-frame in
  // syncGameOverDOM() instead of here

  const closeBtn = gameOverCloseButtonZone();
  positionHudText(goCloseButtonEl, closeBtn.cx, closeBtn.cy - 9, 18, scale);

  positionHudTextBaseline(ptHeaderEl, PT_PANEL.x + PT_PANEL.w / 2, PT_PANEL.y + 18, 12, scale);
  positionHudTextBaseline(ptHintEl, PT_PANEL.x + PT_PANEL.w - 8, PT_PANEL.y + 18, 9.5, scale);
  PERIODIC_ELEMENTS.forEach((el, i) => {
    if (el.z < PERIODIC_OBTAINABLE_MIN_Z) return; // spacer cell - no label
    const cx2 = ptCellX(el.col) + PT_CELL_W / 2, cy2 = ptCellY(el.row) + PT_CELL_H / 2;
    // baseline math assumes one line; obtained cells render two (symbol +
    // a smaller "×N" count line below it, see syncPeriodicTableDOM()), so
    // this is nudged up from a true single-line center to keep the whole
    // two-line block roughly centered in the cell
    positionHudTextBaseline(ptElementEls[i], cx2, cy2 - 1, 11, scale);
  });
  const rz = ptRareEntryZone();
  // as large as the 31x30 cell comfortably allows without touching its edges
  positionHudTextBaseline(ptRareEntryIconEl, (rz.x0 + rz.x1) / 2, (rz.y0 + rz.y1) / 2 + 7, 20, scale);

  // ptRareMode's table: fixed positions for both blocks' column headers and
  // PT_RARE_ROWS_MAX data rows (column-major - top-to-bottom within a block,
  // then the next block) - only text content changes per page/frame (see
  // syncPeriodicTableDOM()), so this only needs to run once here
  for (let col = 0; col < PT_RARE_COLS; col++) {
    const bx = ptRareBlockX0(col);
    for (let sub = 0; sub < 3; sub++) {
      positionHudTextBaseline(ptRareHeaderEls[col * 3 + sub], bx + PT_RARE_SUBCOL_X[sub], PT_RARE_TABLE_HEADER_Y, 9.5, scale);
    }
  }
  const rarePools = [ptRareNuclideEls, ptRareHalfLifeEls, ptRareRatioEls];
  rarePools.forEach((pool, sub) => {
    pool.forEach((el, i) => {
      const col = Math.floor(i / PT_RARE_ROWS_MAX);
      const row = i % PT_RARE_ROWS_MAX;
      positionHudTextBaseline(el, ptRareBlockX0(col) + PT_RARE_SUBCOL_X[sub], PT_RARE_ROW_START_Y + row * PT_RARE_ROW_H, 11, scale);
    });
  });
  const ppz = ptRarePageZone();
  positionHudTextBaseline(ptRarePageEl, PT_PANEL.x + PT_PANEL.w / 2, (ppz.prev.y0 + ppz.prev.y1) / 2 + 4, 11, scale);

  const cpz = ptChainPageZone();
  positionHudTextBaseline(ptChainPageEl, PT_PANEL.x + PT_PANEL.w / 2, (cpz.prev.y0 + cpz.prev.y1) / 2 + 4, 11, scale);
}

function syncGameOverDOM() {
  const visible = state === STATE_GAMEOVER;
  gameOverOverlayEl.classList.toggle("hidden", !visible);
  if (!visible) return;

  const cx = GAME_W / 2, cy = GAMEOVER_CARD_CY;
  const cardW = 340;
  const text = String(score).padStart(6, "0");
  let fontSize = 56;
  ctx.font = `bold ${fontSize}px ${FONT}`;
  const maxWidth = cardW - 40;
  const measured = ctx.measureText(text).width;
  if (measured > maxWidth) fontSize = Math.floor(fontSize * (maxWidth / measured));
  goScoreValueEl.textContent = text;
  positionHudTextBaseline(goScoreValueEl, cx, cy, fontSize, currentUIScale);

  // k = F/(F+S): the fraction of all neutrons in play that came from fission
  // (F, gen>=2) rather than the ship's own shots (S, gen 1) - a rough,
  // session-long stand-in for the reactor-physics "neutron multiplication factor"
  const kText = totalFissionNeutrons + totalPlayerNeutrons > 0 ? `　増倍率 ${computeMultFactor().toFixed(5)}` : "";
  goChainMaxEl.textContent = `最大連鎖 ${chainMax}${kText}`;

  const rankMsgs = [];
  if (lastRunScoreRank > 0) rankMsgs.push(`得点👑${lastRunScoreRank}位`);
  if (lastRunChainRank > 0) rankMsgs.push(`連鎖数🏆${lastRunChainRank}位`);
  if (lastRunMultRank > 0) rankMsgs.push(`増倍率⚛️${lastRunMultRank}位`);
  if (rankMsgs.length > 0) {
    const isTop = lastRunScoreRank === 1 || lastRunChainRank === 1 || lastRunMultRank === 1;
    goRankMsgEl.style.color = isTop ? COLORS.accent : COLORS.u238;
    const rankText = (isTop ? "★ 新記録！ " : "") + rankMsgs.join("／") + (isTop ? " ★" : "");
    goRankMsgEl.textContent = rankText;
    // shrinks to fit when all 3 categories place at once (same pattern as
    // goScoreValueEl above) - otherwise this line can run wider than the card
    let rankFontSize = 14;
    ctx.font = `bold ${rankFontSize}px ${FONT}`;
    const rankMaxWidth = cardW - 40;
    const rankMeasured = ctx.measureText(rankText).width;
    if (rankMeasured > rankMaxWidth) rankFontSize = Math.floor(rankFontSize * (rankMaxWidth / rankMeasured));
    positionHudTextBaseline(goRankMsgEl, cx, cy + 60, rankFontSize, currentUIScale);
  } else {
    goRankMsgEl.textContent = "";
  }

  // hidden entirely while browsing the periodic table (ptCursorActive) - the
  // player's attention (and the shoot button, via ptDrillConfirm()) is on
  // that instead, so a restart reminder here is just noise. Otherwise it
  // reflects gameOverShootPresses: pink + a slow pulse once the first press
  // has registered, so the "press once more" feedback actually stands out
  if (ptCursorActive) {
    goRestartHintEl.textContent = "";
  } else {
    const hitOnce = gameOverShootPresses === 1;
    goRestartHintEl.textContent = GAMEOVER_RESTART_HINT_BY_DEVICE[lastInputDevice][hitOnce ? 1 : 0];
    goRestartHintEl.style.color = hitOnce ? COLORS.accent : COLORS.u238;
    goRestartHintEl.style.opacity = hitOnce ? String(0.55 + 0.45 * (0.5 + 0.5 * Math.sin(fieldScrollY * 0.25))) : "1";
  }

  goCloseButtonEl.style.display = pointsDirectly() ? "" : "none";
}

function syncPeriodicTableDOM() {
  const visible = state === STATE_GAMEOVER;
  if (!visible) return; // element labels stay inert while hidden; the shared overlay's own class handles visibility

  const gridVisible = ptDrillLevel === 0 && !ptRareMode;
  PERIODIC_ELEMENTS.forEach((el, i) => {
    if (el.z < PERIODIC_OBTAINABLE_MIN_Z) return;
    const label = ptElementEls[i];
    if (!gridVisible) { label.textContent = ""; return; }
    const entry = obtainedElements.get(el.z);
    // obtained cells get a second, smaller line showing how many of that
    // element were produced this run (×N) - not-yet-obtained cells just show
    // the bare symbol, matching how they have nothing to count yet
    label.innerHTML = entry ? `${el.sym}<br><span style="font-size:0.62em">×${entry.count}</span>` : el.sym;
    // each family's text color was chosen for contrast against ITS OWN full-strength
    // background (see PERIODIC_CATEGORY_STYLE) - not-yet-obtained cells are pale
    // enough that the plain muted ink reads fine regardless of family
    label.style.color = entry ? PERIODIC_CATEGORY_STYLE[el.cat].text : "rgba(58,47,107,0.35)";
  });
  // magnifying-glass hint only makes sense where its tap zone is actually
  // live: level 0, not already inside the rare-event log itself
  ptRareEntryIconEl.textContent = gridVisible ? "🔍" : "";

  if (ptRareMode) {
    ptHintEl.textContent = "";
    ptHeaderEl.textContent = `発見したレア核反応　${rareEventLog.length}件`;
    ptDecayNodeEls.forEach((el) => (el.textContent = ""));
    ptDecayArrowEls.forEach((el) => (el.textContent = ""));
    const perPage = PT_RARE_COLS * PT_RARE_ROWS_MAX;
    const totalPages = ptRareTotalPages();
    // defensive clamp only - rareEventLog never shrinks mid-run, so this
    // never actually fires except after a fresh resetGame()
    if (ptRarePage > totalPages - 1) ptRarePage = totalPages - 1;
    // newest-first: the event the player just now triggered (the reason
    // they likely opened this screen) belongs at the top of page 1, not
    // buried behind everything from earlier in the run
    const newestFirst = rareEventLog.length ? [...rareEventLog].reverse() : [];
    const pageItems = newestFirst.slice(ptRarePage * perPage, (ptRarePage + 1) * perPage);
    // column headers only make sense once there's a table under them to label
    ptRareHeaderEls.forEach((el, i) => (el.textContent = pageItems.length > 0 ? PT_RARE_HEADER_LABELS[i % 3] : ""));
    ptRareNuclideEls.forEach((nucEl, i) => {
      const hlEl = ptRareHalfLifeEls[i], ratioEl = ptRareRatioEls[i];
      if (i >= pageItems.length) { nucEl.textContent = ""; hlEl.textContent = ""; ratioEl.textContent = ""; return; }
      const ev = pageItems[i];
      const info = RARE_EVENT_TYPE_INFO[ev.type];
      const eff = DECAY_MODE_EFFECT[ev.mode];
      // spells out WHY this made the rare-event list at all: a half-life and
      // (usually tiny) branching-ratio percentage, not just the bare mode
      // label the level-2 decay-chain diagram already shows elsewhere - each
      // gets its own column (see PT_RARE_SUBCOL_X) instead of one long
      // sentence, so values line up for easy scanning across rows
      // no icon here (see RARE_EVENT_TYPE_INFO's own comment) - icons stay
      // exclusive to the live-gameplay log messages that first announced
      // each event; this table only carries the color-coding
      nucEl.innerHTML = `${isotopeHTML(ev.a, elementSymbolForZ(ev.z))} ${eff ? eff.label : ev.mode}`;
      // innerHTML, not textContent: formatHalfLife() emits a raw <sup> tag
      // for extreme half-lives (e.g. K-40's "1.25×10<sup>9</sup>年")
      hlEl.innerHTML = formatHalfLife(ev.halfLife);
      const ratioText = formatRatioPercent(ev.ratio);
      ratioEl.innerHTML = ratioText || "?";
      nucEl.style.color = hlEl.style.color = ratioEl.style.color = info.color;
    });
    if (rareEventLog.length === 0) {
      ptRarePageEl.textContent = "";
      ptChainTextEl.textContent = "まだ記録なし";
      positionHudText(ptChainTextEl, PT_PANEL.x + PT_PANEL.w / 2, PT_PANEL.y + 70, 11, currentUIScale);
    } else {
      ptChainTextEl.textContent = "";
      // only shown (and only tappable/key-navigable, see ptRarePageZone()'s
      // own callers) once there's more than one page to move between
      ptRarePageEl.textContent = totalPages > 1 ? `‹  ${ptRarePage + 1} / ${totalPages}  ›` : "";
    }
    return;
  }
  // only reached with ptRareMode false - clear its table/page indicator so
  // they don't linger behind whatever level 0/1/2 renders below
  ptRareHeaderEls.forEach((el) => (el.textContent = ""));
  ptRareNuclideEls.forEach((el) => (el.textContent = ""));
  ptRareHalfLifeEls.forEach((el) => (el.textContent = ""));
  ptRareRatioEls.forEach((el) => (el.textContent = ""));
  ptRarePageEl.textContent = "";

  // level-0-only operation hint (see ptHintEl's own comment) - cleared once
  // drilled in, since level 1/2 already show a "戻る" button and don't need
  // to explain the modifier-held selection scheme a second time
  ptHintEl.textContent = ptDrillLevel === 0 ? ptOperationHint() : "";

  if (ptDrillLevel === 0) {
    ptHeaderEl.textContent = `発見した元素　${obtainedElements.size}/${PERIODIC_TOTAL_OBTAINABLE}種類`;
    ptChipEls.forEach((el) => (el.textContent = ""));
    ptDecayNodeEls.forEach((el) => (el.textContent = ""));
    ptDecayArrowEls.forEach((el) => (el.textContent = ""));
    ptChainTextEl.textContent = "";
    ptChainPageEl.textContent = "";
  } else if (ptDrillLevel === 1) {
    const el = PERIODIC_OBTAINABLE_ELEMENTS[ptCursorZIndex];
    ptHeaderEl.textContent = `${el.sym}の発見した同位体`;
    ptDecayNodeEls.forEach((n) => (n.textContent = ""));
    ptDecayArrowEls.forEach((n) => (n.textContent = ""));
    ptChainTextEl.textContent = "";
    ptChainPageEl.textContent = "";
    const style = PERIODIC_CATEGORY_STYLE[el.cat];
    const count = Math.min(PT_CHIP_MAX, ptIsotopeList.length);
    ptChipEls.forEach((chipEl, i) => {
      if (i >= count) { chipEl.textContent = ""; return; }
      const a = ptIsotopeList[i];
      const selected = (!pointsDirectly() && ptCursorActive && i === ptIsotopeIndex)
        || (lastInputDevice === "mouse" && i === ptMouseHoverIsotopeIdx);
      const chipCount = obtainedElements.get(el.z).isotopes.get(a);
      chipEl.innerHTML = `${isotopeHTML(a, el.sym)}<br><span style="font-size:0.6em">×${chipCount}個</span>`;
      // style.text was picked for contrast against the family's FULL-OPACITY
      // bg (see PERIODIC_CATEGORY_STYLE) - correct for the selected chip
      // (solid bg), but wrong for the unselected ones (33%-alpha pale bg,
      // see drawPeriodicTablePanel()'s chip fill below). The previous code
      // forced white on selected regardless of family (broke dark-text
      // families like transition metals - white on e.g. #eda100 measures
      // ~2.2:1) and reused style.text on the pale bg regardless of family
      // (broke white-text families like reactive - white on the pale wash
      // measures ~1.6:1, and touch never shows the selected state at all, so
      // every chip a touch user sees was hitting this). Same dark ink used
      // for level 0's not-yet-obtained cells reads fine against any pale
      // family tint (~7:1+), so it covers all three white-text families here too.
      chipEl.style.color = selected ? style.text : COLORS.textDark;
      const r = ptChipRect(i, count);
      // nudged up from a true single-line center (see the equivalent note on
      // ptElementEls above) - now two lines: the isotope label + a smaller "×N個" count
      positionHudTextBaseline(chipEl, r.x + r.w / 2, r.y + r.h / 2 - 2, 13, currentUIScale);
    });
  } else if (ptDrillLevel === 2) {
    ptChipEls.forEach((el) => (el.textContent = ""));
    const el = PERIODIC_OBTAINABLE_ELEMENTS[ptCursorZIndex];
    const a = ptIsotopeList[ptIsotopeIndex];
    ptHeaderEl.innerHTML = `${isotopeHTML(a, el.sym)} の壊変系列`;
    if (ptChainSteps) {
      const totalPages = ptChainTotalPages();
      if (ptChainPage > totalPages - 1) ptChainPage = totalPages - 1; // defensive clamp, see ptRareMode's identical guard
      const pageSteps = ptChainPageSteps();
      const isLastPage = ptChainPage === totalPages - 1;
      const layout = decayNodeLayout(pageSteps.length);
      pageSteps.forEach((s, i) => {
        const nodeEl = ptDecayNodeEls[i];
        nodeEl.innerHTML = isotopeHTML(s.a, elementSymbolForZ(s.z));
        nodeEl.style.color = DECAY_NODE_TEXT_COLOR;
        positionHudTextBaseline(nodeEl, decayNodeX(layout, i), layout.y + 4, 12, currentUIScale);

        if (i < pageSteps.length - 1) {
          const arrowEl = ptDecayArrowEls[i];
          const eff = DECAY_MODE_EFFECT[s.mode];
          const isPrecursor = s.mode && DELAYED_NEUTRON_MODES.has(s.mode);
          // innerHTML, not textContent: formatHalfLife() emits a raw <sup> tag
          // for extreme half-lives (e.g. "1.25×10<sup>9</sup>年") - textContent
          // would print those tag characters literally instead of rendering them
          // stacked on two lines (half-life above the mode label) instead of
          // "mode(half-life)" - there's vertical room to spare between the
          // header and the circle row, and it reads cleaner without parens.
          // the mode label is the more important half of this pair, so it
          // renders noticeably bigger than the half-life line above it
          // margin-top (needs display:inline-block to actually apply) opens a
          // little breathing room between the two lines - .hudText's
          // line-height:1 otherwise packs them edge-to-edge. em-based so it
          // scales together with the span's own (1.5x) font size.
          arrowEl.innerHTML = `${formatHalfLife(s.halfLife)}<br><span style="font-size:1.5em;display:inline-block;margin-top:0.25em">${eff ? eff.label : s.mode}</span>`;
          arrowEl.style.color = isPrecursor ? DELAYED_NEUTRON_COLOR : COLORS.textDark;
          arrowEl.style.fontWeight = isPrecursor ? "bold" : "normal";
          positionHudTextBaseline(arrowEl, decayNodeX(layout, i) + layout.pitch / 2, PT_PANEL.y + 56, 11, currentUIScale);
        }
      });
      for (let i = pageSteps.length; i < ptDecayNodeEls.length; i++) ptDecayNodeEls[i].textContent = "";
      for (let i = Math.max(0, pageSteps.length - 1); i < ptDecayArrowEls.length; i++) ptDecayArrowEls[i].textContent = "";

      ptChainTextEl.innerHTML = decayChainCaption(pageSteps, isLastPage);
      positionHudText(ptChainTextEl, PT_PANEL.x + PT_PANEL.w / 2, PT_PANEL.y + 155, 10, currentUIScale);
      ptChainTextEl.style.width = (PT_PANEL.w - 35) * currentUIScale + "px";
      ptChainPageEl.textContent = totalPages > 1 ? `‹  ${ptChainPage + 1} / ${totalPages}  ›` : "";
    }
  }
}

// text content lives in #gameOverOverlay (see syncGameOverDOM()) - this only
// draws the dim background and the card
function drawGameOver() {
  ctx.save();
  ctx.fillStyle = "rgba(40,25,90,0.45)";
  ctx.fillRect(0, 0, GAME_W, GAME_H);

  const cx = GAME_W / 2, cy = GAMEOVER_CARD_CY;
  const cardW = 340, cardH = 200;
  drawCard(cx - cardW / 2, cy - cardH / 2, cardW, cardH);
  drawPeriodicTablePanel();

  if (pointsDirectly()) {
    // touch/mouse-only "×" close button - a solid red circle so "this closes
    // the screen" reads at a glance, distinct from every other pastel-colored
    // card on screen. the "×" glyph itself lives in #gameOverOverlay (see
    // goCloseButtonEl); this only draws the round background behind it
    const btn = gameOverCloseButtonZone();
    ctx.save();
    ctx.beginPath();
    ctx.arc(btn.cx, btn.cy, btn.visualR, 0, Math.PI * 2);
    ctx.fillStyle = "#e8384f";
    ctx.shadowColor = "rgba(232,56,79,0.5)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// the learning-shot (↑ / gamepad D-pad up) explanation log lives in the
// #learningLog DOM element below the canvas rather than drawn on the canvas.
// the message fade (see syncLearningLogDOM()) only ever applies opacity to
// the inner #learningLogText span, never to #learningLog itself - so the
// box's own white background/border stay fully solid at all times, instead
// of fading toward transparent (and picking up a tint from whatever's behind
// it) along with the text
const learningLogEl = document.getElementById("learningLog");
const learningLogTextEl = document.getElementById("learningLogText");
// the fallback control hint (shown whenever no nuclear-event message is
// active) auto-switches to match whichever input device was used most
// recently - see the keydown listener, handleTouchStart(), and
// gamepadHasActivity() in update() for where lastInputDevice gets set
const CONTROL_HINT_BY_DEVICE = {
  keyboard: "← → : 移動　Z / Space : 中性子ビーム　↑ : 学習ビーム",
  gamepad: "← → : 移動　ボタン : 中性子ビーム　↑ : 学習ビーム",
  touch: "← → : 移動　タップ : 中性子ビーム　↑ : 学習ビーム",
  mouse: "← → : 移動　クリック : 中性子ビーム　↑ : 学習ビーム",
};
let lastInputDevice = "keyboard";
// touch and mouse both select directly (tap/click a specific cell) rather
// than moving a cursor, so the periodic-table browser's keyboard/gamepad
// cursor box and "selected chip" highlight both stay hidden for either
function pointsDirectly() {
  return lastInputDevice === "touch" || lastInputDevice === "mouse";
}

// title-screen "start" prompt and game-over "restart" hint, same
// device-auto-switch idea as CONTROL_HINT_BY_DEVICE above. Gamepad and touch
// have no equivalent to the keyboard's dedicated Enter shortcut, so their
// restart hint always names the (only) 2-press/2-tap path instead
const TITLE_START_HINT_BY_DEVICE = {
  keyboard: "Enter / Z / Space でスタート！",
  gamepad: "ボタン でスタート！",
  touch: "タップ でスタート！",
  mouse: "クリック でスタート！",
};
// [not-yet-pressed text, one-more-press text] per device - the second string
// shows once gameOverShootPresses reaches 1, so the player gets feedback that
// their first press registered instead of wondering why nothing happened yet
// (see syncGameOverDOM(), which also swaps in COLORS.accent + a pulse at
// that point, and hides this hint entirely while ptCursorActive/browsing)
const GAMEOVER_RESTART_HINT_BY_DEVICE = {
  keyboard: ["Enterでリスタート", "もう1回ショットキーでリスタート"],
  gamepad: ["ボタンを2回押しでリスタート", "もう1回ボタン押しでリスタート"],
  touch: ["タップを2回でリスタート", "もう1回タップでリスタート"],
  mouse: ["クリックを2回でリスタート", "もう1回クリックでリスタート"],
};

// periodic-table panel level-0 operation hint (see ptHintEl) - touch/mouse
// select a cell directly, so they just get a plain tap/click hint.
// keyboard/gamepad instead switch on ptCursorActive: before the player has
// ever held Shift/shoulder this game-over screen, arrow keys silently do
// nothing (see updateGameOver()), so this shows a "hold to
// select" discovery hint; once they have (ptCursorActive), it switches to
// the fuller navigate/drill instruction, matching the cursor box/selected-
// chip highlight that appears at the same moment (see drawPeriodicTablePanel())
function ptOperationHint() {
  if (lastInputDevice === "touch") return "元素をタップで詳細";
  if (lastInputDevice === "mouse") return "元素をクリックで詳細";
  if (!ptCursorActive) {
    return lastInputDevice === "gamepad" ? "側面ボタンを押し続けて選択" : "Shiftを押し続けて選択";
  }
  return lastInputDevice === "gamepad" ? "方向キーで選択／ボタンで詳細" : "方向キーで選択／ショットかEnterで詳細";
}

function syncLearningLogDOM() {
  if (!learningLogEl || !learningLogTextEl) return;
  if (!learningLog) {
    // nothing to explain right now - fall back to showing the controls
    learningLogEl.classList.remove("rare");
    learningLogTextEl.innerHTML = CONTROL_HINT_BY_DEVICE[lastInputDevice];
    learningLogTextEl.style.opacity = "1";
    return;
  }
  const fadeStart = LEARNING_LOG_DURATION - 0.6;
  const alpha = learningLog.t < fadeStart ? 1 : Math.max(0, (LEARNING_LOG_DURATION - learningLog.t) / 0.6);
  learningLogEl.classList.toggle("rare", learningLog.rare);
  learningLogTextEl.innerHTML = learningLog.text;
  learningLogTextEl.style.opacity = String(alpha);
}

// keeps the DOM HUD overlay's text content in sync with game state each
// frame; positioning/sizing only needs to be recomputed on resize (see
// positionHudOverlay(), called from resizeCanvas())
function syncHudDOM() {
  // hidden (not just during PLAYING) once GAMEOVER starts, so this bright
  // DOM text doesn't sit undimmed on top of the game-over screen's dimmed
  // backdrop - the game-over card shows its own final score/chain anyway
  const visible = state === STATE_PLAYING;
  hudOverlayEl.classList.toggle("hidden", !visible);
  if (!visible) return;
  hudPlayerNameEl.textContent = `👤 ${playerName || DEFAULT_PLAYER_NAME}`;
  hudScoreValueEl.textContent = String(score);
  hudTimeValueEl.textContent = String(Math.ceil(timeLeft));
  hudChainValueEl.textContent = `${String(chainCount).padStart(2, "0")} / ${String(chainMax).padStart(2, "0")}`;
}

function render() {
  ctx.clearRect(0, 0, GAME_W, GAME_H);
  drawBackground();
  if (state === STATE_PLAYING || state === STATE_GAMEOVER) {
    // clip everything that moves so it never renders outside the playfield frame
    ctx.save();
    ctx.beginPath();
    ctx.rect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H);
    ctx.clip();
    if (screenShake > 0.2) {
      ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
    }
    drawField();
    drawBarrier();
    drawVoidBands();
    drawTargets();
    drawFragments();
    drawItems();
    drawBullets();
    drawPlayer();
    // particles/explosions draw last so juice effects spawned at the ship's
    // own position (e.g. the void-transition splash) aren't hidden behind it
    drawParticles();
    drawExplosions();
    drawChainPopup();
    ctx.restore();
    drawHud();
    if (fissionHistory.length === 0) {
      drawFissionExplainer();
    } else {
      drawFissionYieldChart();
    }
  }
  if (state === STATE_TITLE) drawTitle();
  if (state === STATE_GAMEOVER) drawGameOver();
}

// ---- main loop ----
let lastTime = null;
function loop(ts) {
  if (lastTime === null) lastTime = ts;
  const dt = Math.min(0.05, (ts - lastTime) / 1000);
  lastTime = ts;
  update(dt);
  render();
  syncLearningLogDOM();
  syncHudDOM();
  syncTitleDOM();
  syncFissionExplainerDOM();
  syncGameOverDOM();
  syncPeriodicTableDOM();
  requestAnimationFrame(loop);
}

// ---- input ----
window.addEventListener("keydown", (e) => {
  // while the name-entry box is open, let the browser handle typing normally -
  // its own keydown listener (see confirmNameEntry wiring above) handles Enter
  if (nameEntryOpen) return;
  keys[e.code] = true;
  lastInputDevice = "keyboard";
  if (e.code === "Escape") {
    returnToTitle();
  }
  if (!e.repeat && e.code === "ArrowUp") {
    learnQueued = true;
  }
  // hidden 吸収体 release command - deliberately not shown in the on-screen
  // control hints (see releaseAbsorbedNeutrons()). only meaningful during
  // STATE_PLAYING (see its consumption below) but harmless to set otherwise,
  // same as learnQueued above
  if (!e.repeat && e.code === "ArrowDown") {
    releaseQueued = true;
  }
  if (state === STATE_TITLE && !e.repeat && e.code === "KeyC") {
    // openNameEntry() focuses the input synchronously, so without this the
    // browser's default action for this same keydown types "c" into it
    e.preventDefault();
    openNameEntry();
  }
  // title-screen simulation settings: only adjustable while Shift is held, so
  // players can't accidentally change them while just moving/confirming.
  // Left/right selects (one tap, one step); up/down instead repeats
  // continuously while held - see updateTitle().
  if (state === STATE_TITLE && e.shiftKey && !e.repeat) {
    if (e.code === "ArrowLeft") selectTitleConfig(-1);
    else if (e.code === "ArrowRight") selectTitleConfig(1);
    else {
      // direct numeric entry: digits typed while Shift is held accumulate
      // into a buffer, applied to the selected param once Shift is released
      // (see applyTitleDigitInput()) - !e.repeat so holding one digit key
      // down doesn't spam it via OS key-repeat
      const digit = digitFromKeyCode(e.code);
      if (digit !== null) titleDigitBuffer += digit;
    }
  }
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "Enter"].includes(e.code)) e.preventDefault();
});
window.addEventListener("keyup", (e) => {
  keys[e.code] = false;
  if (state === STATE_TITLE && (e.code === "ShiftLeft" || e.code === "ShiftRight") && !keys["ShiftLeft"] && !keys["ShiftRight"]) {
    applyTitleDigitInput();
  }
});

// ---- gamepad (standard mapping: https://w3c.github.io/gamepad/#remapping) ----
const GAMEPAD_BTN_DPAD_LEFT = 14;
const GAMEPAD_BTN_DPAD_RIGHT = 15;
const GAMEPAD_BTN_DPAD_UP = 12;
const GAMEPAD_BTN_DPAD_DOWN = 13;
// left/right shoulder buttons (LB/RB, L1/R1) - the gamepad equivalent of
// holding Shift, used to gate both the title-screen settings adjustment and
// the game-over periodic-table/decay-chain browser (see ptGpHeld)
const GAMEPAD_BTNS_SHOULDER = [4, 5];
// the four right-side face buttons (A/B/X/Y, Cross/Circle/Square/Triangle, ...)
const GAMEPAD_BTNS_SHOOT = [0, 1, 2, 3];
const GAMEPAD_STICK_DEADZONE = 0.25;
// some gamepads the browser can't auto-map to the "standard" layout report the
// D-pad as a single hat-switch axis instead of discrete buttons 14/15
const GAMEPAD_HAT_AXIS_INDEX = 9;
const GAMEPAD_HAT_RIGHT_CENTER = -3 / 7;
const GAMEPAD_HAT_LEFT_CENTER = 5 / 7;
const GAMEPAD_HAT_TOLERANCE = 1 / 7;

function gamepadButtonPressed(gp, index) {
  const b = gp.buttons[index];
  return !!b && (typeof b === "object" ? b.pressed : b === 1.0);
}

function gamepadShootPressed(gp) {
  for (const btn of GAMEPAD_BTNS_SHOOT) {
    if (gamepadButtonPressed(gp, btn)) return true;
  }
  return false;
}

// returns -1 (left), 1 (right), or 0, combining the standard D-pad buttons
// with the left-side cross-key's hat-switch axis used by non-standard-mapped pads
function gamepadDpadX(gp) {
  if (gamepadButtonPressed(gp, GAMEPAD_BTN_DPAD_LEFT)) return -1;
  if (gamepadButtonPressed(gp, GAMEPAD_BTN_DPAD_RIGHT)) return 1;
  const hat = gp.axes[GAMEPAD_HAT_AXIS_INDEX];
  if (typeof hat === "number") {
    if (Math.abs(hat - GAMEPAD_HAT_LEFT_CENTER) < GAMEPAD_HAT_TOLERANCE) return -1;
    if (Math.abs(hat - GAMEPAD_HAT_RIGHT_CENTER) < GAMEPAD_HAT_TOLERANCE) return 1;
  }
  return 0;
}

// learning-shot trigger: gamepad D-pad up (standard button, or the hat-switch
// axis's "up" value on non-standard-mapped pads)
function gamepadDpadUpPressed(gp) {
  if (gamepadButtonPressed(gp, GAMEPAD_BTN_DPAD_UP)) return true;
  const hat = gp.axes[GAMEPAD_HAT_AXIS_INDEX];
  if (typeof hat === "number" && Math.abs(hat - -1) < GAMEPAD_HAT_TOLERANCE) return true;
  return false;
}

// D-pad down (standard button, or the hat-switch axis's "down" value)
function gamepadDpadDownPressed(gp) {
  if (gamepadButtonPressed(gp, GAMEPAD_BTN_DPAD_DOWN)) return true;
  const hat = gp.axes[GAMEPAD_HAT_AXIS_INDEX];
  if (typeof hat === "number" && Math.abs(hat - 1 / 7) < GAMEPAD_HAT_TOLERANCE) return true;
  return false;
}

function gamepadShoulderHeld(gp) {
  return GAMEPAD_BTNS_SHOULDER.some((btn) => gamepadButtonPressed(gp, btn));
}

function pollGamepad() {
  if (!navigator.getGamepads) return null;
  const pads = navigator.getGamepads();
  for (const gp of pads) {
    if (gp) return gp;
  }
  return null;
}

// unlike keyboard/touch (event-driven), the gamepad is only ever polled -
// this checks whether anything on it is CURRENTLY actuated, so update() can
// tell "the player just used the gamepad" apart from "a gamepad happens to
// be connected" for the control-hint auto-switch (see lastInputDevice)
function gamepadHasActivity(gp) {
  for (let i = 0; i < gp.buttons.length; i++) {
    if (gamepadButtonPressed(gp, i)) return true;
  }
  for (const axis of gp.axes) {
    if (Math.abs(axis) > GAMEPAD_STICK_DEADZONE) return true;
  }
  return false;
}

// ---- touch input (mobile) ----
// touch has no separate "move" vs "shoot" buttons like the keyboard does, so
// every touch on the field starts out as a potential shot (tap = normal
// shot, hold = charge shot - reusing the exact same shootHeld/shootChargeT
// machinery as KeyZ/Space above, so it fires an undercharged shot if
// released and starts a charge if held) and is only reclassified once the
// finger's actual movement reveals a different intent: a fast upward drag
// becomes a learning shot, while any sideways drag (fast or slow) becomes
// ship movement that tracks the finger 1:1 for as long as the touch stays
// down - no need to land the touch on the ship itself. On the title screen,
// long-pressing the ranking panel opens name entry (KeyC); in-game,
// long-pressing the player-name HUD card returns to the title screen (Escape).
function touchLogicalPoint(touch) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((touch.clientX - rect.left) / rect.width) * GAME_W,
    y: ((touch.clientY - rect.top) / rect.height) * GAME_H,
  };
}

const touchSessions = new Map(); // Touch.identifier -> session state
let touchShootHeld = false; // OR'd into shootHeld in update(), mirrors keys["KeyZ"]
let touchLearnFlick = false; // edge-triggered like a fresh ArrowUp press, consumed each frame in updatePlayerAndShooting()
// mouse/touch's own ArrowDown equivalent - a fast DOWNWARD flick, the mirror
// image of touchLearnFlick's upward one (see handleTouchMove()). mouse
// reuses this same touch pipeline (see bindMouseEvents()), so this single
// flag already covers both without any separate mouse-only wiring
let touchReleaseFlick = false;
let touchShootSuppressRelease = false; // see usage in update()

function recomputeTouchShootHeld() {
  touchShootHeld = false;
  for (const s of touchSessions.values()) {
    if (s.mode === "shoot" && !s.consumed) { touchShootHeld = true; return; }
  }
}

// flags every currently-tracked "shoot" touch/mouse session as multi-touch,
// the same protection handleTouchStart() gives a fresh session the instant a
// 2nd+ touch begins on the title screen (see its own comment) - shared here
// because a return to the title screen can also happen from GAMEOVER/PLAYING
// (see returnToTitle() below), where a still-held "shoot" session predates
// the transition and would otherwise never get this flag at all
function markShootSessionsMultiTouch() {
  for (const s of touchSessions.values()) {
    if (s.mode === "shoot") s.multiTouch = true;
  }
}

// every path back to the title screen (Escape, the in-game HUD long-press,
// the game-over close button, mouse right-click) funnels through here rather
// than assigning `state` directly, so an unrelated finger/button that's still
// down when the screen changes (an ordinary in-progress shot, a resting
// thumb, ...) can never be misread as a lone tap-to-start on release - see
// markShootSessionsMultiTouch() above
function returnToTitle() {
  state = STATE_TITLE;
  markShootSessionsMultiTouch();
}

// a fast, mostly-vertical upward drag within a short window of touching down
// reclassifies a shoot touch into a learning shot instead of a normal one
const FLICK_MIN_DIST = 26; // logical px of movement
const FLICK_MAX_DURATION = 400; // ms since touchstart

// a touch anywhere on the field that drags sideways past this threshold (no
// time limit, unlike the learning-shot flick above - this is meant to catch
// slow deliberate drags too, not just quick flicks) converts from a shoot
// touch into ship movement: the ship then tracks the finger's horizontal
// delta live for as long as the touch stays down, so the total distance
// moved naturally matches however far the finger was dragged
const MOVE_DRAG_THRESHOLD = 18; // logical px

// title-screen hit zones - geometry mirrors positionTitleOverlay() /
// drawTitleConfigPanel() so touch targets line up with what's drawn on screen.
// the whole ranking panel (not just the player-name line) opens name entry,
// so it's a comfortably large touch target
function titleNameHitZone() {
  const cx = GAME_W / 2;
  const hsPanelX = cx - HS_PANEL_W / 2, hsPanelY = 14;
  return { x0: hsPanelX, x1: hsPanelX + HS_PANEL_W, y0: hsPanelY, y1: hsPanelY + HS_PANEL_H };
}
// in-game HUD hit zone for the player-name card (top-right) - long-pressing
// it returns to the title screen, mirroring the Escape key
function playerNameHudHitZone() {
  const margin = 8;
  return {
    x0: CARD_PLAYER.x - margin, x1: CARD_PLAYER.x + CARD_PLAYER.w + margin,
    y0: CARD_PLAYER.y - margin, y1: CARD_PLAYER.y + CARD_PLAYER.h + margin,
  };
}
function pointInZone(pt, z) {
  return pt.x >= z.x0 && pt.x <= z.x1 && pt.y >= z.y0 && pt.y <= z.y1;
}
// "×" close button (touch tap or mouse click, both go through
// handleTouchStart's shared MOUSE_ID path) - returns to the title screen.
// Anchored
// at CARD_PLAYER's top-right corner (the same top-right card that shows the
// player's name during gameplay, blank during game-over since the HUD text
// is hidden then - see syncHudDOM()), overflowing slightly outside the card
// like a badge so it can be a comfortable touch size despite that card only
// being 22px tall. visualR is the drawn circle; hitR is deliberately bigger
// than the visual (invisible padding) so it's easy to land a tap on; x0/x1/
// y0/y1 (the hit-zone bounding box) is what handleTouchStart actually tests.
function gameOverCloseButtonZone() {
  const btnCx = CARD_PLAYER.x + CARD_PLAYER.w - 6, btnCy = CARD_PLAYER.y + 8;
  const visualR = 16, hitR = 24;
  return { cx: btnCx, cy: btnCy, visualR, hitR, x0: btnCx - hitR, x1: btnCx + hitR, y0: btnCy - hitR, y1: btnCy + hitR };
}
function titleConfigPanelRect() {
  const cx = GAME_W / 2, cy = GAME_H / 2;
  const tcPanelW = 430, tcPanelH = 148;
  return { x0: cx - tcPanelW / 2, x1: cx + tcPanelW / 2, y0: cy + 76, y1: cy + 76 + tcPanelH, w: tcPanelW };
}
function titleConfigSlotAt(x, y) {
  const r = titleConfigPanelRect();
  if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) return -1;
  const slotW = r.w / TITLE_CONFIG_PARAMS.length;
  return Math.min(TITLE_CONFIG_PARAMS.length - 1, Math.max(0, Math.floor((x - r.x0) / slotW)));
}
function titleConfigBarRange() {
  const r = titleConfigPanelRect();
  return { top: r.y0 + 34, bottom: r.y1 - 26 };
}

const NAME_LONG_PRESS_MS = 500;
const CONFIG_DRAG_THRESHOLD = 6; // logical px before a config-slot touch starts adjusting the value (a plain tap only selects it)

// starts a long-press timer that runs `onFire` if the touch is still held
// (and hasn't been cancelled by drifting out of its hit zone) once the
// threshold elapses - shared by the title-screen name row and the in-game
// player-name HUD ("hold to quit to title")
function startLongPress(id, mode, onFire) {
  const timer = setTimeout(() => {
    const s = touchSessions.get(id);
    if (s && s.mode === mode && !s.cancelled) {
      onFire();
      touchSessions.delete(id);
    }
  }, NAME_LONG_PRESS_MS);
  touchSessions.set(id, { mode, timer, cancelled: false, zone: null });
}

function handleTouchStart(id, pt) {
  lastInputDevice = "touch";
  if (state === STATE_TITLE) { handleTouchStartTitle(id, pt); return; }
  if (state === STATE_PLAYING) { handleTouchStartPlaying(id, pt); return; }
  if (state === STATE_GAMEOVER) { handleTouchStartGameOver(id, pt); return; }
}

function handleTouchStartTitle(id, pt) {
  if (nameEntryOpen) return;
  // a genuine tap-to-start only fires (see handleTouchEnd()) for a "shoot"
  // finger that was ALONE for its whole lifetime. If another touch is
  // already active (any kind - also counts a finger on the ranking
  // panel/config bars), flag every existing "shoot" touch, and this new
  // one too once it's created below - otherwise whichever one releases
  // FIRST would still look like "just a lone touch ending" and wrongly
  // start the game out from under the player mid-way through the
  // ranking-reset hold gesture
  const hasOtherTouches = touchSessions.size >= 1;
  if (hasOtherTouches) markShootSessionsMultiTouch();
  const nz = titleNameHitZone();
  // mouse's equivalent of a long-press is a dedicated right-click (see
  // bindMouseEvents()'s contextmenu handler) - id === MOUSE_ID skips this
  // branch so holding the left button here doesn't ALSO open name entry,
  // keeping the left button exclusively click/drag like everywhere else
  if (id !== MOUSE_ID && pointInZone(pt, nz)) {
    // long-press anywhere on the ranking panel to open the name-entry box,
    // mirroring the KeyC shortcut - fires while still held, like a native long-press
    startLongPress(id, "name", openNameEntry);
    touchSessions.get(id).zone = nz;
    return;
  }
  const slot = titleConfigSlotAt(pt.x, pt.y);
  if (slot !== -1) {
    titleConfigIndex = slot;
    touchSessions.set(id, { mode: "config", slot, startX: pt.x, startY: pt.y, dragging: false });
    return;
  }
  touchSessions.set(id, {
    mode: "shoot", startX: pt.x, startY: pt.y, startTime: performance.now(), consumed: false,
    multiTouch: hasOtherTouches,
  });
  recomputeTouchShootHeld();
}

// shared one-shot "start an ordinary shot" session - used by both
// handleTouchStartPlaying() (away from the quit-HUD) and
// handleTouchStartGameOver() (any tap acts as the shoot/restart button,
// matching shootReleased's role there). A touch anywhere on the field starts
// out as a potential shot - if it's instead dragged sideways (see
// handleTouchMove()), it converts into ship movement, so there's no need to
// land precisely on the ship to grab it
function startGenericShootTouch(id, pt) {
  touchSessions.set(id, { mode: "shoot", startX: pt.x, startY: pt.y, lastX: pt.x, startTime: performance.now(), consumed: false });
  recomputeTouchShootHeld();
}

function handleTouchStartPlaying(id, pt) {
  const hz = playerNameHudHitZone();
  // see the titleNameHitZone() branch above - mouse uses right-click here too
  if (id !== MOUSE_ID && pointInZone(pt, hz)) {
    // long-press the player-name card (top-right HUD) to quit to the title
    // screen, mirroring the Escape key
    startLongPress(id, "quit", () => { returnToTitle(); });
    touchSessions.get(id).zone = hz;
    return;
  }
  startGenericShootTouch(id, pt);
}

function handleTouchStartGameOver(id, pt) {
  const cz = gameOverCloseButtonZone();
  if (pointInZone(pt, cz)) {
    // a plain tap (not a long-press) on the "×" close button returns to
    // the title screen. Registers a placeholder session (never "shoot", so
    // its own eventual release is inert) kept alive until this same finger
    // lifts off - without it, a second finger touching down a moment later
    // (while this one is still physically down but already untracked)
    // wouldn't see it as "another touch present", and that second finger's
    // ordinary shot could be misread as a lone tap-to-start once the title
    // screen appears (see returnToTitle()/markShootSessionsMultiTouch())
    touchSessions.set(id, { mode: "closed" });
    returnToTitle();
    return;
  }
  // decay-chain browser (touch): tapping drills straight to whatever was
  // tapped (unlike keyboard/gamepad, there's no separate cursor-move step),
  // and tapping the panel again backs out one level - a tap on an empty
  // isotope slot (fewer chips than PT_CHIP_MAX) also backs out, since
  // there's nothing there to select
  if (pointInZone(pt, { x0: PT_PANEL.x, x1: PT_PANEL.x + PT_PANEL.w, y0: PT_PANEL.y, y1: PT_PANEL.y + PT_PANEL.h })) {
    // a tap/click on the panel is a browser interaction, not a restart tap -
    // matches the keyboard/gamepad reset above, so 1 restart tap, then a
    // panel tap, then a 2nd restart tap doesn't silently restart the game
    gameOverShootPresses = 0;
    if (ptRareMode) {
      const totalPages = ptRareTotalPages();
      const pz = totalPages > 1 ? ptRarePageZone() : null;
      if (pz && pointInZone(pt, pz.prev)) {
        ptRarePage = (ptRarePage - 1 + totalPages) % totalPages;
      } else if (pz && pointInZone(pt, pz.next)) {
        ptRarePage = (ptRarePage + 1) % totalPages;
      } else {
        // any other tap in the panel backs out, same convention as the
        // decay-chain diagram's level 2 -> 0
        ptRareMode = false;
      }
    } else if (ptDrillLevel === 0 && pointInZone(pt, ptRareEntryZone())) {
      ptCursorZIndex = -1;
      ptDrillConfirm();
    } else if (ptDrillLevel === 0) {
      const idx = ptElementIndexAt(pt.x, pt.y);
      if (idx !== -1) {
        const el = PERIODIC_OBTAINABLE_ELEMENTS[idx];
        const entry = obtainedElements.get(el.z);
        if (entry && entry.isotopes.size > 0) {
          ptCursorZIndex = idx;
          ptDrillConfirm();
        }
      }
    } else if (ptDrillLevel === 1) {
      const idx = ptIsotopeIndexAt(pt.x, pt.y);
      if (idx !== -1) {
        ptIsotopeIndex = idx;
        ptDrillConfirm();
      } else {
        ptDrillLevel = 0;
      }
    } else {
      // level 2: tapping the page strip pages the chain instead of backing
      // out, same prev/next-zone convention as ptRareMode above
      const totalPages = ptChainTotalPages();
      const cz = totalPages > 1 ? ptChainPageZone() : null;
      if (cz && pointInZone(pt, cz.prev)) {
        ptChainPage = (ptChainPage - 1 + totalPages) % totalPages;
      } else if (cz && pointInZone(pt, cz.next)) {
        ptChainPage = (ptChainPage + 1) % totalPages;
      } else {
        ptDrillConfirm(); // any other tap -> back to the grid
      }
    }
    return;
  }
  startGenericShootTouch(id, pt);
}

function handleTouchMove(id, pt) {
  const s = touchSessions.get(id);
  if (!s) return;
  if (s.mode === "move") {
    player.x = Math.max(FIELD_X + player.w / 2, Math.min(FIELD_RIGHT - player.w / 2, player.x + (pt.x - s.lastX)));
    s.lastX = pt.x;
  } else if (s.mode === "shoot" && !s.consumed) {
    const dx = pt.x - s.startX, dy = pt.y - s.startY;
    const elapsedMs = performance.now() - s.startTime;
    if (elapsedMs < FLICK_MAX_DURATION && -dy > FLICK_MIN_DIST && -dy > Math.abs(dx)) {
      // fast upward flick -> learning shot instead of a normal release-shot
      s.consumed = true;
      touchLearnFlick = true;
      touchShootSuppressRelease = true;
      recomputeTouchShootHeld();
    } else if (elapsedMs < FLICK_MAX_DURATION && dy > FLICK_MIN_DIST && dy > Math.abs(dx)) {
      // fast downward flick -> 吸収体 release burst, the mirror image of the
      // upward learning-shot flick just above (mouse/touch's own version of
      // ArrowDown - see releaseQueued/releaseAbsorbedNeutrons())
      s.consumed = true;
      touchReleaseFlick = true;
      touchShootSuppressRelease = true;
      recomputeTouchShootHeld();
    } else if (id !== MOUSE_ID && state === STATE_PLAYING && Math.abs(dx) > MOVE_DRAG_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      // sustained sideways drag -> converts this touch into pure ship
      // movement instead of a shot, so swiping to reposition never also
      // fires a shot on release. catches up to the full drag distance
      // accumulated so far, then tracks incrementally from here. shooting
      // while moving still works fine - just use a second finger, since each
      // touch is tracked independently (see touchSessions). excluded for
      // MOUSE_ID: the mouse/trackpad already gets continuous cursor-follow
      // movement from bindMouseEvents()'s unconditional mousemove listener,
      // so converting a click-drag into "move" too would just double up
      s.mode = "move";
      s.lastX = pt.x;
      touchShootSuppressRelease = true;
      player.x = Math.max(FIELD_X + player.w / 2, Math.min(FIELD_RIGHT - player.w / 2, player.x + dx));
      recomputeTouchShootHeld();
    }
  } else if (s.mode === "config") {
    if (!s.dragging && Math.hypot(pt.x - s.startX, pt.y - s.startY) > CONFIG_DRAG_THRESHOLD) s.dragging = true;
    if (s.dragging) {
      const p = TITLE_CONFIG_PARAMS[s.slot];
      const { top, bottom } = titleConfigBarRange();
      const frac = 1 - Math.max(0, Math.min(1, (pt.y - top) / (bottom - top)));
      const raw = p.min + frac * (p.max - p.min);
      const snapped = Math.round(raw / p.step) * p.step;
      simConfig[p.key] = Math.round(Math.min(p.max, Math.max(p.min, snapped)) * 1000) / 1000;
    }
  } else if ((s.mode === "name" || s.mode === "quit") && s.zone) {
    const margin = 30;
    if (pt.x < s.zone.x0 - margin || pt.x > s.zone.x1 + margin || pt.y < s.zone.y0 - margin || pt.y > s.zone.y1 + margin) {
      clearTimeout(s.timer);
      s.cancelled = true;
    }
  }
}

function handleTouchEnd(id) {
  const s = touchSessions.get(id);
  if (s && s.timer) clearTimeout(s.timer);
  // title-screen tap-to-start fires HERE, on release, instead of being
  // polled every frame while held - a live per-frame check couldn't
  // distinguish "a fast tap that's already over" from "the start of a
  // two-finger hold" without either misfiring on the hold or missing quick
  // taps outright. Only fires for a plain touch that was never joined by a
  // second one (see multiTouch, set retroactively on both fingers the
  // instant a real two-finger touch begins - see handleTouchStart()) - so
  // it doesn't matter which finger of an intentional two-finger hold
  // releases first, neither one can ever also complete as a tap.
  if (state === STATE_TITLE && !nameEntryOpen && s && s.mode === "shoot" && !s.multiTouch && !s.consumed) {
    resetGame();
    state = STATE_PLAYING;
    resetShootHoldState();
  }
  touchSessions.delete(id);
  recomputeTouchShootHeld();
}

// touch listeners are bound to the whole window (not just the canvas) so the
// ship can be dragged/flicked/tapped from the light-blue letterboxing area
// around the canvas too - not just the canvas itself. touchLogicalPoint()'s
// math is a plain linear map from canvas.getBoundingClientRect(), so it keeps
// working correctly for touches outside the canvas rect (it just extrapolates
// to a logical coordinate outside 0..GAME_W/0..GAME_H, which every consumer
// already clamps to the playfield/ship bounds). The one thing that must stay
// carved out is the name-entry overlay, so its input/button keep native
// tap-to-focus/tap-to-click behavior instead of being swallowed as game input.
function isNameEntryTouch(e) {
  return !!(nameEntryOverlayEl && e.target && e.target.closest && e.target.closest("#nameEntryOverlay"));
}
function bindTouchEvents() {
  window.addEventListener("touchstart", (e) => {
    if (isNameEntryTouch(e)) return;
    e.preventDefault();
    for (const t of e.changedTouches) handleTouchStart(t.identifier, touchLogicalPoint(t));
  }, { passive: false });
  window.addEventListener("touchmove", (e) => {
    if (isNameEntryTouch(e)) return;
    e.preventDefault();
    for (const t of e.changedTouches) handleTouchMove(t.identifier, touchLogicalPoint(t));
  }, { passive: false });
  const endHandler = (e) => {
    if (isNameEntryTouch(e)) return;
    e.preventDefault();
    for (const t of e.changedTouches) handleTouchEnd(t.identifier);
  };
  window.addEventListener("touchend", endHandler, { passive: false });
  window.addEventListener("touchcancel", endHandler, { passive: false });
}
bindTouchEvents();

// ---- mouse input (desktop, mirrors touch) ----
// same left/right = drag, up = flick, tap = click mapping as touch, reusing
// touchSessions/handleTouchStart/Move/End verbatim under one synthetic id
// (a mouse is a single pointer, so there's no need for touch's per-identifier
// multi-touch tracking - "MOUSE_ID" just plays the role of a single finger).
// Long-press's mouse equivalent is a right-click: unlike touch's timed hold,
// a right-click is already a distinct, deliberate browser gesture, so it
// fires the same target action immediately instead of running it through
// startLongPress()'s hold-and-cancel-on-drift timer.
function mouseLogicalPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * GAME_W,
    y: ((e.clientY - rect.top) / rect.height) * GAME_H,
  };
}
const MOUSE_ID = "mouse";
let mouseButtonDown = false;
let rightMouseDown = false; // see updateRankingResetGesture()
function isNameEntryMouse(e) {
  return !!(nameEntryOverlayEl && e.target && e.target.closest && e.target.closest("#nameEntryOverlay"));
}
// mouse-hover highlight for the game-over decay-chain browser (see
// ptMouseHoverIdx/ptMouseHoverIsotopeIdx) - only meaningful while a mouse is
// actively hovering (not dragging/clicking) over the panel on the game-over
// screen; anywhere else, or with the button held down, clears both so no
// stale highlight lingers from a previous hover
function updatePtMouseHover(pt) {
  if (state !== STATE_GAMEOVER || mouseButtonDown) {
    ptMouseHoverIdx = -1;
    ptMouseHoverIsotopeIdx = -1;
    ptMouseHoverRareEntry = false;
    return;
  }
  const insidePanel = pointInZone(pt, { x0: PT_PANEL.x, x1: PT_PANEL.x + PT_PANEL.w, y0: PT_PANEL.y, y1: PT_PANEL.y + PT_PANEL.h });
  if (!insidePanel) {
    ptMouseHoverIdx = -1;
    ptMouseHoverIsotopeIdx = -1;
    ptMouseHoverRareEntry = false;
    return;
  }
  ptMouseHoverIdx = ptDrillLevel === 0 && !ptRareMode ? ptElementIndexAt(pt.x, pt.y) : -1;
  ptMouseHoverIsotopeIdx = ptDrillLevel === 1 && !ptRareMode ? ptIsotopeIndexAt(pt.x, pt.y) : -1;
  ptMouseHoverRareEntry = ptDrillLevel === 0 && !ptRareMode && pointInZone(pt, ptRareEntryZone());
}
function bindMouseEvents() {
  window.addEventListener("mousedown", (e) => {
    // right button: tracked separately for the ranking-reset hold gesture
    // (see updateRankingResetGesture()) - not routed through handleTouchStart
    if (e.button === 2) {
      if (!isNameEntryMouse(e)) rightMouseDown = true;
      return;
    }
    if (isNameEntryMouse(e) || e.button !== 0) return;
    e.preventDefault();
    mouseButtonDown = true;
    handleTouchStart(MOUSE_ID, mouseLogicalPoint(e));
    lastInputDevice = "mouse"; // handleTouchStart() tags it "touch" - this is the real source of truth here
  });
  window.addEventListener("mousemove", (e) => {
    if (isNameEntryMouse(e)) return;
    const pt = mouseLogicalPoint(e);
    // laptop trackpads report through the browser as an ordinary mouse (no
    // separate "touchpad" event type exists), so this same listener already
    // covers trackpad play. Movement follows the cursor/finger position
    // directly on every move, click or not - a physical mouse/trackpad has a
    // hover state a touchscreen doesn't, so there's no need to require
    // holding the button down and dragging the way touch does (see
    // MOUSE_ID's exclusion from the click-drag-to-move conversion above);
    // the button is reserved purely for charging/firing a shot.
    if (state === STATE_PLAYING) {
      lastInputDevice = "mouse";
      player.x = Math.max(FIELD_X + player.w / 2, Math.min(FIELD_RIGHT - player.w / 2, pt.x));
    } else if (state === STATE_GAMEOVER) {
      lastInputDevice = "mouse";
      updatePtMouseHover(pt);
    }
    if (mouseButtonDown) handleTouchMove(MOUSE_ID, pt);
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 2) { rightMouseDown = false; return; }
    if (e.button !== 0 || !mouseButtonDown) return;
    mouseButtonDown = false;
    handleTouchEnd(MOUSE_ID);
  });
  // right-click = the same "long-press" targets touch has: the title
  // ranking panel (open name entry) and the in-game player-name HUD (quit to
  // title) - see titleNameHitZone()/playerNameHudHitZone() and their
  // startLongPress() call sites in handleTouchStartTitle()/handleTouchStartPlaying()
  window.addEventListener("contextmenu", (e) => {
    if (isNameEntryMouse(e)) return;
    e.preventDefault();
    lastInputDevice = "mouse";
    const pt = mouseLogicalPoint(e);
    if (state === STATE_TITLE && !nameEntryOpen && pointInZone(pt, titleNameHitZone())) {
      openNameEntry();
    } else if (state === STATE_PLAYING && pointInZone(pt, playerNameHudHitZone())) {
      returnToTitle();
    }
  });
}
bindMouseEvents();

// ---- boot ----
// no image assets to preload - everything is drawn procedurally
// (positions/sizes the DOM text overlays for the first time; must run after
// TITLE_CONFIG_PARAMS/MAX_RECORDS and the overlay elements they generate exist)
resizeCanvas();
requestAnimationFrame(loop);
