/// <reference lib="webworker" />

import { solveNpnBjt2D, sweepNpnOutput } from "../bjt-core.js";
import { loadNpnWasmBackend } from "../bjt-wasm-backend.js";
import type { NpnConfig, NpnResult } from "../types";

type NpnSolver = (config: NpnConfig, previous?: NpnResult | null) => NpnResult;
const loadBackend = loadNpnWasmBackend as unknown as (url: URL) => Promise<{ solve: NpnSolver }>;
const solveJavaScript = solveNpnBjt2D as unknown as NpnSolver;
const sweepOutput = sweepNpnOutput as unknown as (
  config: NpnConfig,
  collectorVoltages: number[],
  previous: NpnResult | null,
  solver: NpnSolver,
) => any;

const solverPromise: Promise<NpnSolver> = loadBackend(
  new URL("../../assets/wasm/bjt-core.wasm", import.meta.url),
).then((backend) => backend.solve.bind(backend)).catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  return (config: NpnConfig, previousSolution?: NpnResult | null): NpnResult => {
    const started = performance.now();
    const result = solveJavaScript(config, previousSolution);
    result.diagnostics.elapsedMs = performance.now() - started;
    result.diagnostics.backend = "JavaScript fallback";
    result.warnings = [...new Set([...result.warnings, `WebAssembly could not be loaded; JavaScript fallback used: ${reason}`])];
    return result;
  };
});

let cachedFamily: any = null;
let cachedSummary: any = null;
let cachedKey = "";
let cancelRequested = false;
let solving = false;

self.addEventListener("message", async ({ data }: MessageEvent) => {
  try {
    if (data.action === "cancel") {
      cancelRequested = true;
      return;
    }
    if (data.action === "sweep") {
      if (solving) throw new Error("A characteristic grid is already being calculated.");
      const key = JSON.stringify([data.config, data.baseVoltages, data.collectorVoltages]);
      if (key === cachedKey && cachedSummary) {
        self.postMessage({ action: "swept", result: cachedSummary, cached: true });
        return;
      }
      solving = true;
      cancelRequested = false;
      const solver = await solverPromise;
      const baseVoltages = data.baseVoltages as number[];
      const collectorVoltages = data.collectorVoltages as number[];
      if (!baseVoltages.length || !collectorVoltages.length) throw new RangeError("Both voltage axes require at least one point.");
      const total = baseVoltages.length * collectorVoltages.length;
      const curves: any[] = [];
      const solvedPoints: NpnResult[] = [];
      let previousAtZero: NpnResult | null = null;
      let completed = 0;
      self.postMessage({ action: "progress", completed, total });
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (cancelRequested) {
        self.postMessage({ action: "cancelled", completed, total });
        return;
      }

      for (const baseEmitterVoltageV of baseVoltages) {
        const points: any[] = [];
        let previous: NpnResult | null = previousAtZero;
        for (const collectorEmitterVoltageV of collectorVoltages) {
          const sweep = sweepOutput(
            { ...data.config, baseEmitterVoltageV, collectorEmitterVoltageV },
            [collectorEmitterVoltageV],
            previous,
            solver,
          );
          const point = sweep.points[0];
          points.push(point);
          if (point?.result) solvedPoints.push(point.result);
          previous = point?.result ?? null;
          if (points.length === 1) previousAtZero = previous;
          completed += 1;
          self.postMessage({ action: "progress", completed, total, baseEmitterVoltageV, collectorEmitterVoltageV });
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (cancelRequested) {
            self.postMessage({ action: "cancelled", completed, total });
            return;
          }
          if (!point?.converged) break;
        }
        curves.push({
          baseEmitterVoltageV,
          config: { ...data.config, baseEmitterVoltageV },
          points,
          converged: points.length === collectorVoltages.length && points.every((point) => point.converged),
          warnings: [],
        });
        if (!curves.at(-1).converged) break;
      }

      const family = {
        config: data.config,
        curves,
        converged: curves.length === baseVoltages.length && curves.every((curve) => curve.converged),
      };
      const summary = {
        config: family.config,
        converged: family.converged,
        backend: solvedPoints[0]?.diagnostics.backend ?? "Unknown",
        elapsedMs: solvedPoints.reduce((totalMs, result) => totalMs + (result.diagnostics.elapsedMs ?? 0), 0),
        curves: family.curves.map((curve) => ({
          baseEmitterVoltageV: curve.baseEmitterVoltageV,
          converged: curve.converged,
          points: curve.points.map(({ result: _result, ...point }: any) => point),
        })),
      };
      if (family.converged) {
        cachedFamily = family;
        cachedSummary = summary;
        cachedKey = key;
      }
      self.postMessage({ action: "swept", result: summary, cached: false });
      return;
    }
    if (data.action === "select") {
      const curveIndex = Number(data.curveIndex);
      const pointIndex = Number(data.pointIndex);
      const result = cachedFamily?.curves[curveIndex]?.points[pointIndex]?.result as NpnResult | undefined;
      if (!Number.isInteger(curveIndex) || !Number.isInteger(pointIndex) || !result?.diagnostics.converged) {
        throw new RangeError("Select a converged point from the current characteristic grid.");
      }
      self.postMessage({ action: "selected", curveIndex, pointIndex, result });
      return;
    }
    throw new Error(`Unknown worker action: ${String(data.action)}`);
  } catch (error) {
    self.postMessage({ action: "failed", message: error instanceof Error ? error.message : String(error) });
  } finally {
    if (data.action === "sweep") solving = false;
  }
});

export {};
