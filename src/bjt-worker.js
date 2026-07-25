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

self.addEventListener("message", async ({ data }) => {
  try {
    const solver = await solverPromise;
    if (data.action === "solve") {
      self.postMessage({ action: "solved", result: solver(data.config, data.previousSolution) });
      return;
    }
    if (data.action === "sweep") {
      const family = sweepNpnOutputFamily(data.config, null, null, solver);
      const solvedPoints = family.curves.flatMap((curve) =>
        curve.points.map((point) => point.result).filter(Boolean));
      self.postMessage({
        action: "swept",
        result: {
          config: family.config,
          converged: family.converged,
          backend: solvedPoints[0]?.diagnostics.backend ?? "Unknown",
          elapsedMs: solvedPoints.reduce(
            (total, result) => total + (result.diagnostics.elapsedMs ?? 0),
            0,
          ),
          curves: family.curves.map((curve) => ({
            baseEmitterVoltageV: curve.baseEmitterVoltageV,
            converged: curve.converged,
            points: curve.points.map(({ result: _result, ...point }) => point),
          })),
        },
      });
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
