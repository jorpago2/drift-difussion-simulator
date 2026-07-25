import { solveNpnBjt2D, sweepNpnOutputFamily } from "./bjt-core.js";

self.addEventListener("message", ({ data }) => {
  try {
    if (data.action === "solve") {
      self.postMessage({ action: "solved", result: solveNpnBjt2D(data.config, data.previousSolution) });
      return;
    }
    if (data.action === "sweep") {
      const family = sweepNpnOutputFamily(data.config);
      self.postMessage({
        action: "swept",
        result: {
          config: family.config,
          converged: family.converged,
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
