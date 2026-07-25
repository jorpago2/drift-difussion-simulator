export async function loadDdmWasmBackend(url, cells) {
  const layout = createLayout(cells);
  const memory = new WebAssembly.Memory({ initial: layout.pages, maximum: Math.max(layout.pages, 64) });
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load ${url}: ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, { env: { memory } });
  return new DdmWasmBackend(memory, instance.exports, layout);
}

class DdmWasmBackend {
  constructor(memory, exports, layout) {
    this.memory = memory;
    this.exports = exports;
    this.layout = layout;
    this.capacity = layout.cells;
    this.views = createViews(memory, layout);
  }

  attach(sim) {
    if (sim.cells > this.capacity) {
      throw new Error("WASM backend capacity is smaller than the simulation grid.");
    }
    const views = this.views;
    views.potential.set(sim.potential);
    views.electron.set(sim.electron);
    views.hole.set(sim.hole);
    views.dopant.set(sim.dopant);
    views.epsRel.set(sim.epsRel);
    views.material.set(sim.material);
    views.contactMask.set(sim.contactMask);
    views.contactPotential.set(sim.contactPotential);

    sim.potential = views.potential.subarray(0, sim.cells);
    sim.electron = views.electron.subarray(0, sim.cells);
    sim.hole = views.hole.subarray(0, sim.cells);
    sim.dopant = views.dopant.subarray(0, sim.cells);
    sim.epsRel = views.epsRel.subarray(0, sim.cells);
    sim.material = views.material.subarray(0, sim.cells);
    sim.contactMask = views.contactMask.subarray(0, sim.cells);
    sim.contactPotential = views.contactPotential.subarray(0, sim.cells);
    sim.wasmBackend = this;
    sim.backendName = "WASM";
    return sim;
  }

  relaxPotential(sim, sweeps, omega) {
    return this.exports.poisson_relax(
      sim.nx,
      sim.ny,
      this.layout.potential,
      this.layout.electron,
      this.layout.hole,
      this.layout.dopant,
      this.layout.epsRel,
      this.layout.material,
      this.layout.contactMask,
      this.layout.contactPotential,
      sim.poissonScale,
      omega,
      sweeps,
    );
  }
}

function createLayout(cells) {
  let offset = 0;
  const take = (bytes, alignment = 8) => {
    offset = align(offset, alignment);
    const start = offset;
    offset += bytes;
    return start;
  };
  const floatBytes = cells * Float64Array.BYTES_PER_ELEMENT;
  const layout = {
    cells,
    potential: take(floatBytes),
    electron: take(floatBytes),
    hole: take(floatBytes),
    dopant: take(floatBytes),
    epsRel: take(floatBytes),
    contactPotential: take(floatBytes),
    material: take(cells, 1),
    contactMask: take(cells, 1),
  };
  layout.bytes = align(offset, 65536);
  layout.pages = Math.max(1, Math.ceil(layout.bytes / 65536));
  return layout;
}

function createViews(memory, layout) {
  const buffer = memory.buffer;
  return {
    potential: new Float64Array(buffer, layout.potential, layout.cells),
    electron: new Float64Array(buffer, layout.electron, layout.cells),
    hole: new Float64Array(buffer, layout.hole, layout.cells),
    dopant: new Float64Array(buffer, layout.dopant, layout.cells),
    epsRel: new Float64Array(buffer, layout.epsRel, layout.cells),
    contactPotential: new Float64Array(buffer, layout.contactPotential, layout.cells),
    material: new Uint8Array(buffer, layout.material, layout.cells),
    contactMask: new Uint8Array(buffer, layout.contactMask, layout.cells),
  };
}

function align(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}
