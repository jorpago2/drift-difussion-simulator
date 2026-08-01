/// <reference lib="webworker" />

import { createPnVoltageGrid, sweepPnJunction } from "../ddm-core.js";
import type { PnConfig, PnResult } from "../types";

const voltageGrid = createPnVoltageGrid as (pointCount: number, minimumV: number, maximumV: number) => number[];
const sweepJunction = sweepPnJunction as unknown as (config: PnConfig, voltages: number[]) => {
  config: PnConfig;
  converged: boolean;
  warnings: string[];
  points: Array<Record<string, unknown> & { result: PnResult | null }>;
};
let cachedResults: Array<PnResult | null> = [];

self.addEventListener("message", ({ data }: MessageEvent) => {
  try {
    if (data.action === "sweep") {
      const started = performance.now();
      const voltages = voltageGrid(data.pointCount, data.minimumV, data.maximumV);
      const sweep = sweepJunction(data.config as PnConfig, voltages);
      cachedResults = sweep.points.map((point) => point.result);
      self.postMessage({
        action: "swept",
        result: {
          config: sweep.config,
          converged: sweep.converged,
          warnings: sweep.warnings,
          elapsedMs: performance.now() - started,
          points: sweep.points.map(({ result: _result, ...point }) => point),
        },
      });
      return;
    }
    if (data.action === "select") {
      const index = Number(data.index);
      const result = cachedResults[index];
      if (!Number.isInteger(index) || !result?.diagnostics.converged) {
        throw new RangeError("Select a converged point from the current voltage sweep.");
      }
      self.postMessage({ action: "selected", index, result });
      return;
    }
    throw new Error(`Unknown worker action: ${String(data.action)}`);
  } catch (error) {
    self.postMessage({ action: "failed", message: error instanceof Error ? error.message : String(error) });
  }
});

export {};
