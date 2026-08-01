/// <reference lib="webworker" />

import { solveNpnBjt2D, sweepNpnOutputFamily } from "../bjt-core.js";
import { loadNpnWasmBackend } from "../bjt-wasm-backend.js";
import type { NpnConfig, NpnResult } from "../types";

type NpnSolver = (config: NpnConfig, previous?: NpnResult | null) => NpnResult;
const loadBackend = loadNpnWasmBackend as unknown as (url: URL) => Promise<{ solve: NpnSolver }>;
const solveJavaScript = solveNpnBjt2D as unknown as NpnSolver;
const sweepFamily = sweepNpnOutputFamily as unknown as (
  config: NpnConfig,
  baseVoltages: number[],
  collectorVoltages: number[],
  solver: NpnSolver,
) => any;

const solverPromise: Promise<NpnSolver> = loadBackend(
  new URL("../../assets/wasm/bjt-core.wasm", import.meta.url),
).then((backend) =>
  backend.solve.bind(backend)).catch((error: unknown) => {
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

self.addEventListener("message", async ({ data }: MessageEvent) => {
  try {
    const solver = await solverPromise;
    if (data.action === "sweep") {
      cachedFamily = sweepFamily(data.config, data.baseVoltages, data.collectorVoltages, solver);
      const solvedPoints: NpnResult[] = cachedFamily.curves.flatMap((curve: any) =>
        curve.points.map((point: any) => point.result).filter(Boolean));
      self.postMessage({
        action: "swept",
        result: {
          config: cachedFamily.config,
          converged: cachedFamily.converged,
          backend: solvedPoints[0]?.diagnostics.backend ?? "Unknown",
          elapsedMs: solvedPoints.reduce((total, result) => total + (result.diagnostics.elapsedMs ?? 0), 0),
          curves: cachedFamily.curves.map((curve: any) => ({
            baseEmitterVoltageV: curve.baseEmitterVoltageV,
            converged: curve.converged,
            points: curve.points.map(({ result: _result, ...point }: any) => point),
          })),
        },
      });
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
  }
});

export {};
