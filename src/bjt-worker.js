import { solveNpnBjt2D, sweepNpnOutputFamily } from "./bjt-core.js";
import { loadNpnWasmBackend } from "./bjt-wasm-backend.js";

const solverPromise = loadNpnWasmBackend(
  new URL("../assets/wasm/bjt-core.wasm", import.meta.url),
).then((backend) => backend.solve.bind(backend)).catch((error) => {
  const reason = error instanceof Error ? error.message : String(error);
  return (config, previousSolution) => {
    const started = performance.now();
    const result = solveNpnBjt2D(config, previousSolution);
    result.diagnostics.elapsedMs = performance.now() - started;
    result.diagnostics.backend = "JavaScript fallback";
    result.warnings = [...new Set([
      ...result.warnings,
      `WebAssembly could not be loaded; JavaScript fallback used: ${reason}`,
    ])];
    return result;
  };
});

let cachedFamily = null;

self.addEventListener("message", async ({ data }) => {
  try {
    const solver = await solverPromise;
    if (data.action === "sweep") {
      cachedFamily = sweepNpnOutputFamily(
        data.config,
        data.baseVoltages,
        data.collectorVoltages,
        solver,
      );
      const solvedPoints = cachedFamily.curves.flatMap((curve) =>
        curve.points.map((point) => point.result).filter(Boolean));
      self.postMessage({
        action: "swept",
        result: {
          config: cachedFamily.config,
          converged: cachedFamily.converged,
          backend: solvedPoints[0]?.diagnostics.backend ?? "Unknown",
          elapsedMs: solvedPoints.reduce(
            (total, result) => total + (result.diagnostics.elapsedMs ?? 0),
            0,
          ),
          curves: cachedFamily.curves.map((curve) => ({
            baseEmitterVoltageV: curve.baseEmitterVoltageV,
            converged: curve.converged,
            points: curve.points.map(({ result: _result, ...point }) => point),
          })),
        },
      });
      return;
    }
    if (data.action === "select") {
      const curveIndex = Number(data.curveIndex);
      const pointIndex = Number(data.pointIndex);
      const result = cachedFamily?.curves[curveIndex]?.points[pointIndex]?.result;
      if (!Number.isInteger(curveIndex) || !Number.isInteger(pointIndex) || !result?.diagnostics.converged) {
        throw new RangeError("Select a converged point from the current characteristic grid.");
      }
      self.postMessage({ action: "selected", curveIndex, pointIndex, result });
      return;
    }
    throw new Error(`Unknown worker action: ${data.action}`);
  } catch (error) {
    self.postMessage({
      action: "failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
