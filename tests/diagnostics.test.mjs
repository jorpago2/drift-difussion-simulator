import assert from "node:assert/strict";
import test from "node:test";
import { actionableWarnings, classifyDeviceWarning, meshWarnings } from "../src/lib/diagnostics.ts";

test("model-scope limitations do not masquerade as numerical failures", () => {
  assert.equal(classifyDeviceWarning("Avalanche and tunneling are omitted."), "model-scope");
  assert.deepEqual(actionableWarnings(["Avalanche and tunneling are omitted."]), []);
});

test("under-resolved Debye and depletion regions become mesh warnings", () => {
  const warnings = ["The mesh has fewer than three intervals across the shortest Debye length.", "The emitter-base depletion region has fewer than twenty x intervals."];
  assert.equal(meshWarnings(warnings).length, 2);
});
