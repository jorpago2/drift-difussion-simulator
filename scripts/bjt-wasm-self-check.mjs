import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { solveNpnBjt2D } from "../src/bjt-core.js";
import { createNpnWasmBackend } from "../src/bjt-wasm-backend.js";

const bytes = await readFile(new URL("../assets/wasm/bjt-core.wasm", import.meta.url));
const backend = await createNpnWasmBackend(bytes);
const config = {
  nx: 81,
  ny: 17,
  baseEmitterVoltageV: 0.5,
  collectorEmitterVoltageV: 0.6,
};

const wasmStart = performance.now();
const wasm = backend.solve(config);
const wasmElapsedMs = performance.now() - wasmStart;
const javascriptStart = performance.now();
const javascript = solveNpnBjt2D(config);
const javascriptElapsedMs = performance.now() - javascriptStart;

assert.equal(wasm.diagnostics.converged, true, wasm.diagnostics.failureReason);
assert.equal(javascript.diagnostics.converged, true, javascript.diagnostics.failureReason);
assert.equal(wasm.diagnostics.backend, "WebAssembly C");
assert.ok(relativeDifference(
  wasm.terminalCurrents.collector.currentIntoDeviceA,
  javascript.terminalCurrents.collector.currentIntoDeviceA,
) < 1e-8, "WASM and JavaScript collector currents must agree.");
assert.ok(relativeDifference(
  wasm.terminalCurrents.base.currentIntoDeviceA,
  javascript.terminalCurrents.base.currentIntoDeviceA,
) < 1e-8, "WASM and JavaScript base currents must agree.");
assert.ok(maximumAbsoluteDifference(
  wasm.normalizedPotential,
  javascript.normalizedPotential,
) < 1e-8, "WASM and JavaScript potentials must agree.");

const continued = backend.solve({ ...config, collectorEmitterVoltageV: 0.7 }, wasm);
assert.equal(continued.diagnostics.converged, true, continued.diagnostics.failureReason);
assert.equal(continued.config.collectorEmitterVoltageV, 0.7);
assert.ok(continued.terminalCurrents.collector.currentIntoDeviceA >
  wasm.terminalCurrents.collector.currentIntoDeviceA);

console.log(
  `2D NPN WASM self-check passed: parity and continuation; ` +
  `${wasmElapsedMs.toFixed(1)} ms WASM vs ${javascriptElapsedMs.toFixed(1)} ms JavaScript.`,
);

function relativeDifference(left, right) {
  return Math.abs(left - right) / Math.max(1e-30, Math.abs(left), Math.abs(right));
}

function maximumAbsoluteDifference(left, right) {
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(left[index] - right[index]));
  }
  return maximum;
}
