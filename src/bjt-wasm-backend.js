import {
  canReuseNpnResult,
  finalizeNpnKernelState,
  validateNpnConfig,
} from "./bjt-core.js";

const ARRAY_COUNT = 24;
const DIAGNOSTIC_COUNT = 26;
const PARAMETER_COUNT = 23;
const DEFAULT_CAPACITY = 501 * 121;
// ponytail: fixed WASI stack/data reserve; use exported __heap_base if the native runtime grows.
const RUNTIME_RESERVED_BYTES = 1024 * 1024;

export async function loadNpnWasmBackend(url, capacity = DEFAULT_CAPACITY) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
  return createNpnWasmBackend(await response.arrayBuffer(), capacity);
}

export async function createNpnWasmBackend(bytes, capacity = DEFAULT_CAPACITY) {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new RangeError("WASM capacity must be a positive integer.");
  }
  const layout = createLayout(capacity);
  const memory = new WebAssembly.Memory({ initial: layout.pages, maximum: layout.pages });
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      memory,
      exp: Math.exp,
      log: Math.log,
    },
    wasi_snapshot_preview1: {
      args_get: () => 0,
      args_sizes_get: (countPointer, bytesPointer) => {
        const values = new Uint32Array(memory.buffer);
        values[countPointer >>> 2] = 0;
        values[bytesPointer >>> 2] = 0;
        return 0;
      },
      proc_exit: (code) => {
        throw new Error(`The NPN WASM runtime exited with status ${code}.`);
      },
    },
  });
  if (
    instance.exports.npn_array_count() !== ARRAY_COUNT ||
    instance.exports.npn_diagnostic_count() !== DIAGNOSTIC_COUNT
  ) {
    throw new Error("The NPN WASM memory contract is incompatible with this application.");
  }
  return new NpnWasmBackend(memory, instance.exports, layout);
}

class NpnWasmBackend {
  constructor(memory, exports, layout) {
    this.memory = memory;
    this.exports = exports;
    this.layout = layout;
    this.views = createViews(memory, layout);
    this.name = "WebAssembly C";
  }

  solve(input = {}, previousSolution = null) {
    const validation = validateNpnConfig(input);
    if (validation.errors.length) throw new RangeError(validation.errors.join(" "));
    const { config, derived } = validation;
    const size = config.nx * config.ny;
    if (size > this.layout.capacity) {
      throw new RangeError(`The NPN grid exceeds the WASM capacity of ${this.layout.capacity} nodes.`);
    }
    const reusable = canReuseNpnResult(previousSolution, config);
    const potential = this.views.array(0, size);
    const electron = this.views.array(1, size);
    const hole = this.views.array(2, size);
    if (reusable) {
      potential.set(previousSolution.normalizedPotential);
      electron.set(previousSolution.normalizedElectron);
      hole.set(previousSolution.normalizedHole);
    }
    const parameters = this.views.parameters;
    parameters.fill(0);
    parameters.set([
      derived.lengthM,
      derived.heightM,
      derived.emitterWidthM,
      derived.baseWidthM,
      derived.emitterM3 / derived.intrinsicM3,
      derived.baseM3 / derived.intrinsicM3,
      derived.collectorM3 / derived.intrinsicM3,
      derived.thermalVoltageV,
      derived.intrinsicM3,
      config.relativePermittivity,
      config.electronMobilityM2Vs,
      config.holeMobilityM2Vs,
      config.electronLifetimeS,
      config.holeLifetimeS,
      config.baseEmitterVoltageV,
      config.collectorEmitterVoltageV,
      config.maxIterations,
      config.residualTolerance,
      config.conservationTolerance,
      reusable ? previousSolution.config.baseEmitterVoltageV : 0,
      reusable ? previousSolution.config.collectorEmitterVoltageV : 0,
      reusable ? previousSolution.diagnostics.damping : 0.5,
      reusable ? previousSolution.diagnostics.totalIterations : 0,
    ]);
    this.views.diagnostics.fill(0);
    const started = now();
    const statusCode = this.exports.npn_solve(
      this.layout.capacity,
      config.nx,
      config.ny,
      reusable ? 1 : 0,
      this.layout.arrays,
      this.layout.contact,
      this.layout.diagnostics,
      this.layout.parameters,
    );
    const elapsedMs = now() - started;
    const diagnostics = this.views.diagnostics;
    const terminalCurrents = {
      emitter: terminalFrom(diagnostics, 13),
      base: terminalFrom(diagnostics, 16),
      collector: terminalFrom(diagnostics, 19),
    };
    const metrics = {
      poissonResidual: diagnostics[4],
      electronResidual: diagnostics[5],
      holeResidual: diagnostics[6],
      terminalKclError: diagnostics[7],
      terminalKclAbsoluteErrorAm: diagnostics[8],
      terminalKclAbsoluteToleranceAm: diagnostics[9],
      electronBalanceError: diagnostics[10],
      holeBalanceError: diagnostics[11],
      integratedRecombinationAm: diagnostics[12],
      terminalCurrents,
      failureReason: statusCode === 0 ? "" : failureReason(statusCode),
      backend: this.name,
      elapsedMs,
      linearIterations: diagnostics[25],
    };
    return finalizeNpnKernelState(config, {
      potential,
      electron,
      hole,
      baseEmitterVoltageV: diagnostics[22],
      collectorEmitterVoltageV: diagnostics[23],
      converged: diagnostics[0] === 1 && statusCode === 0,
      iterations: diagnostics[1],
      totalIterations: diagnostics[2],
      damping: diagnostics[3],
      metrics,
    });
  }
}

function terminalFrom(diagnostics, offset) {
  return {
    electronAm: diagnostics[offset],
    holeAm: diagnostics[offset + 1],
    totalAm: diagnostics[offset + 2],
  };
}

function failureReason(statusCode) {
  const reasons = {
    10: "The WASM backend rejected the numerical configuration.",
    20: "The WASM equilibrium Poisson solve failed.",
    21: "The WASM equilibrium state did not satisfy the coupled residuals.",
    30: "The WASM Poisson linear solve failed.",
    31: "The WASM electron-continuity solve failed.",
    32: "The WASM hole-continuity solve failed.",
    33: "The WASM Gummel iteration limit was reached.",
    34: "The WASM final state did not satisfy every convergence criterion.",
  };
  return reasons[statusCode] ?? `The WASM backend failed with status ${statusCode}.`;
}

function createLayout(capacity) {
  let offset = RUNTIME_RESERVED_BYTES;
  const take = (bytes, alignment = 8) => {
    offset = Math.ceil(offset / alignment) * alignment;
    const start = offset;
    offset += bytes;
    return start;
  };
  const layout = {
    capacity,
    parameters: take(PARAMETER_COUNT * Float64Array.BYTES_PER_ELEMENT),
    diagnostics: take(DIAGNOSTIC_COUNT * Float64Array.BYTES_PER_ELEMENT),
    contact: take(capacity, 1),
    arrays: take(ARRAY_COUNT * capacity * Float64Array.BYTES_PER_ELEMENT),
  };
  layout.bytes = Math.ceil(offset / 65536) * 65536;
  layout.pages = Math.max(1, layout.bytes / 65536);
  return layout;
}

function createViews(memory, layout) {
  return {
    parameters: new Float64Array(memory.buffer, layout.parameters, PARAMETER_COUNT),
    diagnostics: new Float64Array(memory.buffer, layout.diagnostics, DIAGNOSTIC_COUNT),
    contact: new Uint8Array(memory.buffer, layout.contact, layout.capacity),
    array(index, length = layout.capacity) {
      return new Float64Array(
        memory.buffer,
        layout.arrays + index * layout.capacity * Float64Array.BYTES_PER_ELEMENT,
        length,
      );
    },
  };
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}
