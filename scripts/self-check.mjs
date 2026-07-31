import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_PN_CONFIG,
  bernoulli,
  createPnVoltageGrid,
  neutralCarrierPair,
  serializePnProfileCsv,
  serializePnSweepCsv,
  shockleyReferenceCurrentDensity,
  solvePnJunction1D,
  sweepPnJunction,
  validatePnConfig,
} from "../src/ddm-core.js";
import { createNiceScale, drawScientificText, formatChartTick } from "../src/plot-utils.js";

const pnHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
const pnApp = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const pnStyles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
assert.match(pnHtml, /id="resultsArea" class="results-area" aria-labelledby=/);
assert.match(pnHtml, /<details id="validationView"[^>]*dashboard-validation/);
assert.match(pnHtml, /<details class="dashboard-section dashboard-wide validation-view physics-view">/);
assert.match(pnHtml, /<details class="result-tools">/);
assert.doesNotMatch(pnHtml, /id="resultExplanation"/);
assert.match(pnHtml, /id="jvView"[^>]*dashboard-primary dashboard-wide/);
assert.match(pnHtml, /id="minimumBiasInput"[^>]*value="-1"/);
assert.match(pnHtml, /id="maximumBiasInput"[^>]*value="0.65"/);
assert.match(pnHtml, /id="jvPointCountInput"[^>]*min="17" max="201"[^>]*value="67"/);
assert.match(pnHtml, /id="jvQuantitySelect"/);
assert.match(pnHtml, /id="jvScaleSelect"/);
assert.match(pnHtml, /id="jvReferenceInput"[^>]*checked/);
assert.match(pnHtml, /id="profilePointInput"[^>]*type="range"/);
assert.doesNotMatch(pnHtml, /id="biasInput"|id="generateJvButton"/);
assert.match(pnApp, /async function solveVoltageSweep\(\)/);
assert.doesNotMatch(pnApp, /solveCurrentConfiguration|generateJvSweep/);
assert.match(pnHtml, /class="space-charge space-charge-p"/);
assert.match(pnHtml, /class="space-charge space-charge-n"/);
assert.equal(pnHtml.match(/data-plot-state="empty"/g)?.length, 6);
assert.doesNotMatch(pnApp, /resultsArea\.hidden|deviceOverview\.hidden/);
assert.equal(pnApp.match(/\["Scaled residuals \(ψ \/ n \/ p\)"/g)?.length, 2);
assert.match(pnStyles, /#electrostaticsView \.plot-grid \{[\s\S]{0,120}repeat\(3/);

const voltageScale = createNiceScale([-1, 0.65], 8);
assert.deepEqual(voltageScale.ticks, [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75]);
const currentScale = createNiceScale([-1e-12, 2.9], 7, true);
assert.deepEqual(currentScale.ticks, [0, 0.5, 1, 1.5, 2, 2.5, 3]);
assert.equal(formatChartTick(-0.75, voltageScale.step), "-0.75");
assert.equal(formatChartTick(0, voltageScale.step), "0");
assert.equal(formatChartTick(1e-15), "1.0e-15");

const customVoltageGrid = createPnVoltageGrid(101);
assert.equal(customVoltageGrid.length, 101);
assert.equal(customVoltageGrid[0], -1);
assert.equal(customVoltageGrid.at(-1), 0.65);
assert.ok(customVoltageGrid.includes(0));
assert.ok(customVoltageGrid.every((value, index) => index === 0 || value > customVoltageGrid[index - 1]));
const forwardVoltageGrid = createPnVoltageGrid(17, 0.1, 0.7);
assert.equal(forwardVoltageGrid[0], 0.1);
assert.equal(forwardVoltageGrid.at(-1), 0.7);
assert.equal(forwardVoltageGrid.length, 17);
assert.throws(() => createPnVoltageGrid(Number.NaN), /pointCount/);
assert.throws(() => createPnVoltageGrid(17, 0.5, 0.1), /minimumV/);

const scientificLabelCalls = [];
const scientificLabelContext = {
  font: "700 12px sans-serif",
  textAlign: "left",
  fillText: (text, x, y) => scientificLabelCalls.push({ text, x, y }),
  measureText: (text) => ({ width: text.length * 10 }),
  save() {},
  restore() {},
};
drawScientificText(scientificLabelContext, "V_CE (V)", 0, 10);
assert.deepEqual(scientificLabelCalls.map(({ text }) => text), ["V", "CE", " (V)"]);
assert.ok(scientificLabelCalls[1].y > scientificLabelCalls[0].y);

assert.equal(bernoulli(0), 1);
for (const x of [-80, -4, -0.2, 0.2, 4, 80]) {
  assert.ok(Number.isFinite(bernoulli(x)));
  assert.ok(Math.abs(Math.exp(Math.min(x, 80)) * bernoulli(x) - bernoulli(-x)) < 1e-9);
}

for (const dopant of [-1e8, 0, 1e8]) {
  const pair = neutralCarrierPair(dopant);
  assert.ok(Math.abs(pair.electron * pair.hole - 1) < 1e-8);
  assert.ok(Math.abs(pair.electron - pair.hole - dopant) / Math.max(1, Math.abs(dopant)) < 1e-8);
}

assert.throws(() => solvePnJunction1D({ acceptorCm3: NaN }), RangeError);
assert.throws(() => solvePnJunction1D({ donorCm3: -1 }), RangeError);
assert.throws(() => solvePnJunction1D({ cells: 400 }), RangeError);
assert.throws(() => solvePnJunction1D({ deviceAreaUm2: NaN }), RangeError);
assert.throws(() => solvePnJunction1D({ deviceAreaUm2: 0 }), RangeError);
assert.equal(validatePnConfig(DEFAULT_PN_CONFIG).errors.length, 0);
assert.equal(validatePnConfig(DEFAULT_PN_CONFIG).derived.deviceAreaM2, 1e-8);
assert.equal(DEFAULT_PN_CONFIG.cells, 801);

const equilibrium = solvePnJunction1D({ biasV: 0, cells: 401 });
assert.ok(equilibrium.diagnostics.converged);
const simulatedBuiltInV = equilibrium.potentialV.at(-1) - equilibrium.potentialV[0];
assert.ok(
  Math.abs(simulatedBuiltInV - equilibrium.derived.builtInPotentialV) /
  equilibrium.derived.builtInPotentialV < 0.005,
);
assert.ok(Math.abs(equilibrium.diagnostics.meanCurrentDensityAm2) < 1e-5);
assert.ok(maxAbs(equilibrium.recombinationM3s) < 1e12);

const reverse = solvePnJunction1D({ biasV: -0.5, cells: 401 }, equilibrium);
const moderateForward = solvePnJunction1D({ biasV: 0.3, cells: 401 }, equilibrium);
const strongForward = solvePnJunction1D({ biasV: 0.6, cells: 401 }, moderateForward);
for (const result of [reverse, moderateForward, strongForward]) {
  assert.ok(result.diagnostics.converged, result.diagnostics.failureReason);
  assert.ok(result.diagnostics.poissonResidual < 1e-8);
  assert.ok(result.diagnostics.electronResidual < 1e-8);
  assert.ok(result.diagnostics.holeResidual < 1e-8);
  assert.ok(result.diagnostics.currentContinuityError < 1e-3);
  assert.ok(result.diagnostics.electronBalanceError < 1e-3);
  assert.ok(result.diagnostics.holeBalanceError < 1e-3);
}
assert.ok(reverse.diagnostics.meanCurrentDensityAm2 < 0);
assert.ok(moderateForward.diagnostics.meanCurrentDensityAm2 > 0);
assert.ok(strongForward.diagnostics.meanCurrentDensityAm2 > moderateForward.diagnostics.meanCurrentDensityAm2);
assert.ok(Math.min(...reverse.recombinationM3s) < 0);
assert.ok(Math.max(...moderateForward.recombinationM3s) > 0);

for (const biasV of [-0.01, 0.01]) {
  const nearEquilibrium = solvePnJunction1D({ biasV, cells: 401 }, equilibrium);
  assert.ok(nearEquilibrium.diagnostics.converged, nearEquilibrium.diagnostics.failureReason);
  assert.ok(nearEquilibrium.diagnostics.currentContinuityError < 1e-3);
  assert.ok(
    nearEquilibrium.diagnostics.currentContinuityAbsoluteErrorAm2 <=
    nearEquilibrium.diagnostics.currentContinuityAbsoluteToleranceAm2,
  );
  assert.ok(nearEquilibrium.diagnostics.electronBalanceError < 1e-3);
  assert.ok(nearEquilibrium.diagnostics.holeBalanceError < 1e-3);
}

const coarse = solvePnJunction1D({ biasV: 0.3, cells: 201 });
const fine = solvePnJunction1D({ biasV: 0.3, cells: 801 });
assert.ok(coarse.diagnostics.converged);
assert.ok(fine.diagnostics.converged);
const coarseCurrentDifference = relativeDifference(
  coarse.diagnostics.meanCurrentDensityAm2,
  moderateForward.diagnostics.meanCurrentDensityAm2,
);
const fineCurrentDifference = relativeDifference(
  fine.diagnostics.meanCurrentDensityAm2,
  moderateForward.diagnostics.meanCurrentDensityAm2,
);
assert.ok(fineCurrentDifference < coarseCurrentDifference);
assert.ok(relativeDifference(
  fine.diagnostics.meanCurrentDensityAm2,
  moderateForward.diagnostics.meanCurrentDensityAm2,
) < 0.02);
assert.ok(relativeDifference(maxAbs(fine.fieldVm), maxAbs(moderateForward.fieldVm)) < 0.02);
assert.ok(matchingGridDifference(moderateForward.potentialV, fine.potentialV) < 0.02);

const shockleyLow = shockleyReferenceCurrentDensity(DEFAULT_PN_CONFIG, 0.1);
const shockleyHigh = shockleyReferenceCurrentDensity(DEFAULT_PN_CONFIG, 0.3);
assert.ok(shockleyLow > 0 && shockleyHigh > shockleyLow);

const sweep = sweepPnJunction({ cells: 201 }, [-0.5, 0, 0.1, 0.3, 0.6]);
assert.ok(sweep.converged);
assert.ok(sweep.points.every((point) => Number.isFinite(point.currentDensityAm2)));
assert.ok(sweep.points[0].currentDensityAm2 < 0);
assert.ok(sweep.points.at(-1).currentDensityAm2 > sweep.points.at(-2).currentDensityAm2);

const profileCsv = serializePnProfileCsv(equilibrium);
assert.equal(profileCsv.trimEnd().split("\n").length, equilibrium.xM.length + 5);
assert.match(profileCsv, /x_um,doping_cm-3,potential_V/);
assert.match(profileCsv, /Jn_A_cm-2,Jp_A_cm-2,Jtotal_A_cm-2,In_A,Ip_A,Itotal_A/);
const sweepCsv = serializePnSweepCsv(sweep);
assert.equal(sweepCsv.trimEnd().split("\n").length, sweep.points.length + 3);
assert.match(sweepCsv, /voltage_V,I_A,J_A_cm-2,I_Shockley_A,J_Shockley_A_cm-2/);
const firstSweepRow = sweepCsv.trimEnd().split("\n").at(-sweep.points.length).split(",");
assert.equal(Number(firstSweepRow[1]), sweep.points[0].currentDensityAm2 * 1e-8);

console.log("self-check passed");

function maxAbs(values) {
  let maximum = 0;
  for (const value of values) maximum = Math.max(maximum, Math.abs(value));
  return maximum;
}

function relativeDifference(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
}

function matchingGridDifference(coarseValues, fineValues) {
  const stride = (fineValues.length - 1) / (coarseValues.length - 1);
  let difference = 0;
  let scale = 0;
  for (let i = 0; i < coarseValues.length; i += 1) {
    difference = Math.max(difference, Math.abs(coarseValues[i] - fineValues[i * stride]));
    scale = Math.max(scale, Math.abs(coarseValues[i]), Math.abs(fineValues[i * stride]));
  }
  return difference / Math.max(scale, Number.MIN_VALUE);
}
