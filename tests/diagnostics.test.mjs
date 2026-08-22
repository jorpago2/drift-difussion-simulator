import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("heatmaps expose a textual summary linked to the rendered surface", async () => {
  const source = await readFile(new URL("../src/components/Heatmap.tsx", import.meta.url), "utf8");
  assert.match(source, /<span id=\{summaryId\} className="scientific-visually-hidden">\{summary\}<\/span>/);
  assert.match(source, /aria-describedby=\{summaryId\}/);
  assert.match(source, /finite values ranging from/);
});

test("solver workers and SVG export expose recoverable failure paths", async () => {
  const [pn, bjt, chart] = await Promise.all([
    readFile(new URL("../src/labs/PnLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/labs/BjtLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/LineChart.tsx", import.meta.url), "utf8"),
  ]);
  for (const source of [pn, bjt]) {
    assert.match(source, /worker\.onerror/);
    assert.match(source, /worker\.onmessageerror/);
    assert.match(source, /Inputs were preserved; try again/);
  }
  assert.match(chart, /downloadSvg: \(filename: string\) => Promise<boolean>/);
  assert.match(chart, /if \(!plotlyRef\.current \|\| !plotRef\.current \|\| !plotReadyRef\.current\) return false/);
});
