import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_NPN_CONFIG,
  idealNpnTransportCurrentA,
  serializeNpnProfileCsv,
  serializeNpnSweepCsv,
  solveNpnBjt2D,
  sweepNpnOutputFamily,
  validateNpnConfig,
} from "../src/bjt-core.js";

const validation = validateNpnConfig(DEFAULT_NPN_CONFIG);
assert.equal(validation.errors.length, 0);
assert.ok(!validation.warnings.some((warning) => /mesh|interval|punch-through/i.test(warning)));
assert.throws(() => solveNpnBjt2D({ emitterDopingCm3: NaN }), RangeError);
assert.throws(() => solveNpnBjt2D({ baseDopingCm3: -1 }), RangeError);
assert.throws(() => solveNpnBjt2D({ nx: 80 }), RangeError);
assert.throws(() => solveNpnBjt2D({ ny: 8 }), RangeError);
assert.throws(() => solveNpnBjt2D({ emitterWidthUm: 1.4, baseWidthUm: 0.5 }), RangeError);
assert.throws(() => sweepNpnOutputFamily(DEFAULT_NPN_CONFIG, [0.5], []), RangeError);
assert.throws(() => sweepNpnOutputFamily(DEFAULT_NPN_CONFIG, [], [0, 0.1]), RangeError);
assert.throws(() => sweepNpnOutputFamily(DEFAULT_NPN_CONFIG, [NaN], [0, 0.1]), RangeError);

const [bjtHtml, bjtApp, bjtWorker] = await Promise.all([
  readFile(new URL("../bjt.html", import.meta.url), "utf8"),
  readFile(new URL("../src/bjt-app.js", import.meta.url), "utf8"),
  readFile(new URL("../src/bjt-worker.js", import.meta.url), "utf8"),
]);
for (const id of [
  "bjtVbeMinInput", "bjtVbeMaxInput", "bjtBasePointCountInput",
  "bjtVceMaxInput", "bjtCollectorPointCountInput", "bjtTransferCanvas",
]) assert.ok(bjtHtml.includes(`id="${id}"`), `Missing BJT sweep control #${id}`);
assert.ok(!bjtHtml.includes('id="bjtVbeInput"'));
assert.ok(!bjtHtml.includes('id="bjtVceInput"'));
assert.ok(!bjtHtml.includes("data-bjt-view"));
assert.ok(bjtApp.includes("solveCharacteristicGrid"));
assert.ok(!bjtApp.includes("solveOperatingPoint"));
assert.ok(bjtWorker.includes('data.action === "select"'));
assert.ok(bjtWorker.includes("cachedFamily"));

assert.equal(idealNpnTransportCurrentA(DEFAULT_NPN_CONFIG, 0.55, 0), 0);
const idealLowVce = idealNpnTransportCurrentA(DEFAULT_NPN_CONFIG, 0.55, 0.05);
const idealActive = idealNpnTransportCurrentA(DEFAULT_NPN_CONFIG, 0.55, 0.8);
assert.ok(Number.isFinite(idealLowVce) && idealLowVce > 0);
assert.ok(Number.isFinite(idealActive) && idealActive > idealLowVce);
assert.ok(Number.isFinite(idealNpnTransportCurrentA({ nx: 41, ny: 9 }, 0.55, 0.8)));
assert.ok(idealNpnTransportCurrentA(DEFAULT_NPN_CONFIG, 0.58, 0.8) > idealActive);
assert.ok(Number.isNaN(idealNpnTransportCurrentA(DEFAULT_NPN_CONFIG, 0.75, 0.8)));

const common = {
  lengthUm: 2,
  heightUm: 0.4,
  emitterWidthUm: 0.5,
  baseWidthUm: 0.5,
  emitterDopingCm3: 8e15,
  baseDopingCm3: 4e15,
  collectorDopingCm3: 1e15,
  maxIterations: 140,
};

const equilibrium = solveNpnBjt2D({
  ...common,
  baseEmitterVoltageV: 0,
  collectorEmitterVoltageV: 0,
  nx: 41,
  ny: 9,
});
assertConverged(equilibrium);
assert.ok(maxAbs(equilibrium.recombinationM3s) < 1e13);
assert.ok(maxTerminalCurrent(equilibrium) < 1e-12);
for (let index = 0; index < equilibrium.electronM3.length; index += 1) {
  const massAction = equilibrium.electronM3[index] * equilibrium.holeM3[index];
  const intrinsicSquared = equilibrium.derived.intrinsicM3 ** 2;
  assert.ok(Math.abs(massAction / intrinsicSquared - 1) < 1e-9);
}

const meshes = [[41, 9], [81, 17], [161, 33]];
const active = [];
for (const [nx, ny] of meshes) {
  const result = solveNpnBjt2D({
    ...common,
    baseEmitterVoltageV: 0.5,
    collectorEmitterVoltageV: 0.6,
    nx,
    ny,
  });
  assertConverged(result);
  assert.ok(result.terminalCurrents.collector.currentIntoDeviceA > 0);
  assert.ok(result.terminalCurrents.base.currentIntoDeviceA > 0);
  assert.ok(result.terminalCurrents.emitter.currentIntoDeviceA < 0);
  assert.ok(
    result.terminalCurrents.collector.currentIntoDeviceA /
      result.terminalCurrents.base.currentIntoDeviceA > 1.5,
  );
  for (const name of [
    "electronCurrentDensityXAm2", "electronCurrentDensityYAm2",
    "holeCurrentDensityXAm2", "holeCurrentDensityYAm2",
    "totalCurrentDensityXAm2", "totalCurrentDensityYAm2",
  ]) {
    assert.equal(result[name].length, nx * ny);
    assert.ok(result[name].every(Number.isFinite));
  }
  active.push(result);
}

const medium = active[1];
const fine = active[2];
assert.ok(relativeDifference(
  medium.terminalCurrents.collector.currentIntoDeviceA,
  fine.terminalCurrents.collector.currentIntoDeviceA,
) < 0.02);
assert.ok(relativeDifference(
  medium.terminalCurrents.base.currentIntoDeviceA,
  fine.terminalCurrents.base.currentIntoDeviceA,
) < 0.02);
let potentialDifferenceV = 0;
let potentialScaleV = 0;
for (let iy = 0; iy < medium.ny; iy += 1) {
  for (let ix = 0; ix < medium.nx; ix += 1) {
    const mediumValue = medium.potentialV[iy * medium.nx + ix];
    const fineValue = fine.potentialV[(2 * iy) * fine.nx + 2 * ix];
    potentialDifferenceV = Math.max(potentialDifferenceV, Math.abs(mediumValue - fineValue));
    potentialScaleV = Math.max(potentialScaleV, Math.abs(fineValue));
  }
}
assert.ok(potentialDifferenceV / Math.max(fine.derived.thermalVoltageV, potentialScaleV) < 0.02);

const family = sweepNpnOutputFamily(
  { ...common, baseEmitterVoltageV: 0.55, collectorEmitterVoltageV: 0.8, nx: 41, ny: 9 },
  [0.49, 0.52, 0.55],
  [0, 0.2, 0.4, 0.6, 0.8],
);
assert.ok(family.converged);
for (const curve of family.curves) {
  const forwardActive = curve.points.slice(1).map((point) => point.collectorCurrentA);
  assert.ok(forwardActive.every((current) => current > 0));
  for (let index = 1; index < forwardActive.length; index += 1) {
    assert.ok(forwardActive[index] > forwardActive[index - 1]);
  }
}
for (let curve = 1; curve < family.curves.length; curve += 1) {
  assert.ok(family.curves[curve].points.at(-1).collectorCurrentA >
    family.curves[curve - 1].points.at(-1).collectorCurrentA);
}

const profileCsv = serializeNpnProfileCsv(active[0]);
assert.ok(profileCsv.includes("charge_C_m-3"));
assert.ok(profileCsv.includes("Jn_x_A_m-2"));
assert.equal(profileCsv.trim().split("\n").length, active[0].nx * active[0].ny + 6);
const sweepCsv = serializeNpnSweepCsv(family.curves[0]);
assert.ok(sweepCsv.includes("V_CE_V,I_C_A,I_B_A,I_E_A"));
assert.equal(sweepCsv.trim().split("\n").length, family.curves[0].points.length + 4);

console.log("2D NPN self-check passed: equilibrium, active operation, conservation, three-mesh refinement, output family, and CSV.");

function assertConverged(result) {
  assert.ok(result.diagnostics.converged, result.diagnostics.failureReason);
  assert.ok(result.diagnostics.poissonResidual < result.config.residualTolerance);
  assert.ok(result.diagnostics.electronResidual < result.config.residualTolerance);
  assert.ok(result.diagnostics.holeResidual < result.config.residualTolerance);
  assert.ok(result.diagnostics.terminalKclError < result.config.conservationTolerance);
  assert.ok(result.diagnostics.electronBalanceError < result.config.conservationTolerance);
  assert.ok(result.diagnostics.holeBalanceError < result.config.conservationTolerance);
  assert.ok(result.electronM3.every((value) => Number.isFinite(value) && value > 0));
  assert.ok(result.holeM3.every((value) => Number.isFinite(value) && value > 0));
}

function relativeDifference(left, right) {
  return Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), Number.MIN_VALUE);
}

function maxTerminalCurrent(result) {
  return Math.max(...Object.values(result.terminalCurrents).map((terminal) =>
    Math.abs(terminal.currentIntoDeviceA)));
}

function maxAbs(values) {
  let maximum = 0;
  for (const value of values) maximum = Math.max(maximum, Math.abs(value));
  return maximum;
}
