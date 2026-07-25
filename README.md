# Semiconductor Drift-Diffusion Laboratories

A dependency-free teaching simulator with two validated silicon-device laboratories:

- a stationary 1D PN junction, focused on the diode I–V characteristic; and
- a stationary 2D lateral NPN transistor, focused on the IC–VCE output family.

The PN interface guides students through four stages:
**Device → Solve → Results → Validate**. Before the solver runs, the application
shows only the physical structure; an initial condition is never presented as a
converged solution.

The NPN laboratory is a full three-terminal 2D Poisson–continuity calculation,
not a compact model or a pair of independent junctions. The old generic 2D, MOS,
and legacy Poisson-only WASM paths remain experimental. The NPN numerical kernel
uses its own C/WebAssembly implementation.

On desktop viewports, controls are docked at the right and can be collapsed;
on smaller screens they open as a modal panel. Plots use a high-density canvas
backing store so curves and labels remain sharp on HiDPI displays.

The primary result is the diode I–V characteristic. Solving an operating point
automatically computes the 67-point curve; electrostatic, carrier, and band
profiles remain available as secondary views that explain the terminal behavior.

## Run

A recent Node.js version is required only to serve the ES modules and run the
self-check:

```powershell
node scripts\serve-static.mjs
```

Open `http://127.0.0.1:8769/` for the PN diode or
`http://127.0.0.1:8769/bjt.html` for the NPN transistor. To verify both numerical
cores:

```powershell
npm test
```

The compiled NPN WASM asset is committed, so no build step is required to run
the site. Developers with WASI SDK or compatible Clang can rebuild it with:

```powershell
npm run build:bjt-wasm
```

## Physical model

The domain contains a centered abrupt junction, ohmic contacts, and a cathode
held at 0 V. The bias convention is

```text
V_D = V_A - V_C.
```

The core self-consistently solves Poisson's equation and the stationary carrier
continuity equations:

```text
d/dx (ε dψ/dx) = -q (p - n + N_D - N_A)
dJ_n/dx =  q R_SRH
dJ_p/dx = -q R_SRH
```

Electron and hole fluxes use Scharfetter–Gummel discretization. Recombination
uses a midgap SRH trap:

```text
R_SRH = (np - n_i²) /
        [τ_p (n + n_i) + τ_n (p + n_i)].
```

The model assumes nondegenerate silicon, complete ionization, Boltzmann
statistics, and constant permittivity and mobilities. Bands and quasi-Fermi
levels are relative energies with an arbitrary zero.

## Numerical method

`src/ddm-core.js` exposes the public API:

- `validatePnConfig(config)` validates ranges and estimates `V_bi`, depletion
  width, Debye lengths, and spatial step.
- `solvePnJunction1D(config, previousSolution?)` solves one bias point.
- `sweepPnJunction(config, voltages?)` generates the numerical I–V sweep from
  the internally computed current density and the defined area.
- `shockleyReferenceCurrentDensity(config, voltage)` provides an independent
  low-injection diode reference with finite-base `coth(W/L)` corrections.

Equilibrium is solved first using Poisson–Boltzmann. Each requested voltage is
reached by continuation with steps no larger than 25 mV. Gummel iteration uses
tridiagonal systems, Slotboom variables for the continuity equations, local SRH
linearization, and adaptive damping. Each point allows up to 200 iterations and
fails explicitly unless it satisfies

```text
Poisson residual       < 1e-8
electron residual      < 1e-8
hole residual          < 1e-8
current nonuniformity  < 1e-3
electron SRH balance  < 1e-3
hole SRH balance      < 1e-3
```

Current conservation uses both a relative error and an absolute floating-point
safeguard near zero current; small currents are never assigned an artificial
zero error. The integrated checks independently verify
`Jn(right) - Jn(left) = q integral(R dx)` and
`Jp(right) - Jp(left) = -q integral(R dx)`.

Core quantities use SI units. The one-dimensional solver returns current density
in A/m². A separately defined device area (10,000 µm² by default) converts it to
terminal current through `I = J A`; changing area scales current but does not
change the one-dimensional solution. The interface retains J in A/cm² for
device-level comparison.

## 2D lateral NPN model

The NPN domain is a rectangular N–P–N silicon region. The emitter and collector
are ohmic contacts on the left and right boundaries; a finite-width base contact
is centered over the base on the top boundary. Every remaining boundary is
insulating. Voltages and conventional currents use

```text
V_E = 0,  V_BE = V_B - V_E,  V_CE = V_C - V_E
I_E = I_C + I_B  (reported positive out of the emitter).
```

`native/bjt-core/bjt-core.c` solves 2D Poisson and both stationary continuity
equations in WebAssembly on a node-centered Cartesian control-volume mesh.
`src/bjt-core.js` remains the independent JavaScript reference implementation
and owns validation, result construction, and exports. Face fluxes use
Scharfetter–Gummel discretization; SRH recombination, statistics, and material
assumptions match the PN model. Gummel continuation first establishes
equilibrium, then advances VCE and VBE in steps no larger than 0.1 V. Each
nonlinear update uses matrix-free preconditioned conjugate gradients and fails
explicitly on loss of positivity, linear-solver failure, or iteration exhaustion.
The worker selects WASM by default and reports an explicit JavaScript fallback
if the binary cannot be loaded.

The NPN result includes potential, electric field, charge, electron and hole
density, SRH recombination, and electron, hole, and total current-density vector
fields in SI units. Terminal current is first integrated in A/m for the 2D cross
section and then multiplied by the explicitly configured device depth. The
depth therefore scales all terminal currents without changing the 2D fields.

The default 161 × 33 mesh resolves the shortest Debye length with more than
three intervals and each estimated depletion region with more than twenty
x intervals. Preflight also warns if the base depletion estimates overlap or
if the collector-side depletion estimate reaches the collector contact.
Converged NPN points require

```text
Poisson residual          < 1e-6
electron residual         < 1e-6
hole residual             < 1e-6
terminal KCL error        < 1e-2
electron SRH balance      < 1e-2
hole SRH balance          < 1e-2
```

The tolerances are looser than in 1D because terminal fluxes are integrated over
a 2D contact boundary, but they are still checked independently. The default
lateral teaching geometry has modest current gain; β is a computed outcome,
not a fitted parameter. The IC–VCE family contains three VBE curves and nine
fully converged VCE points per curve. A default browser sweep can take several
minutes.

The NPN public API is:

- `validateNpnConfig(config)`
- `solveNpnBjt2D(config, previousSolution?)`
- `sweepNpnOutput(config, collectorVoltages?, previousSolution?)`
- `sweepNpnOutputFamily(config, baseVoltages?, collectorVoltages?)`
- `serializeNpnProfileCsv(result)` and `serializeNpnSweepCsv(sweep)`

## Parameters and warnings

Defaults: 300 K, εr = 11.7, ni = 10¹⁰ cm⁻³, Eg = 1.12 eV,
μn = 1350 cm²/(V·s), μp = 480 cm²/(V·s), NA = ND = 10¹⁶ cm⁻³,
4 µm length, τn = τp = 10 ns, and 801 nodes.

Inputs are restricted to:

| Parameter | Range |
|---|---:|
| NA, ND | 10¹⁴–10¹⁸ cm⁻³ |
| Length | 1–20 µm |
| Device area | 1–10⁸ µm² |
| VD | −1–0.8 V |
| Odd mesh | 101–2001 nodes |
| τn, τp | 10⁻¹²–10⁻³ s |

The preflight warns when the spatial step does not adequately resolve the
shortest Debye length or estimated depletion width. A warning does not imply
convergence; the residual and conservation diagnostics above determine whether a result may be
displayed and exported. Each editable field explains why its hard range exists;
passing a hard range is necessary but does not by itself establish model
validity.

## Interpretation and validation

The **Validate** stage compares the built-in potential against
`V_T ln(NA ND / ni²)`, checks spatial current conservation, reports all three
residuals, and summarizes mesh adequacy. The analytical diode curve is
deliberately independent of the solver, includes finite-base correction, and
appears only in the low-injection range; agreement with it is not a convergence
criterion.

`scripts/self-check.mjs` verifies the Bernoulli function, neutrality, mass
action, built-in potential, equilibrium current and SRH, convergence at −0.5,
0, 0.3, and 0.6 V, current-density sign and monotonicity, current conservation,
integrated SRH balance, near-equilibrium bias points, 201/401/801-node
refinement, invalid-input rejection, and CSV serialization.
The refinement criterion requires less than 2% difference between the 401- and
801-node meshes.

`scripts/bjt-self-check.mjs` independently checks NPN input rejection,
equilibrium mass action and zero terminal current, forward-active current signs,
all three residuals, KCL and separate carrier balances, positivity, 41 × 9 /
81 × 17 / 161 × 33 mesh refinement, ordering of the output curves, current-field
arrays, and CSV dimensions. Between the two finest meshes, collector current,
base current, and the sampled potential field must each differ by less than 2%.

`scripts/bjt-wasm-self-check.mjs` compares the C/WASM and JavaScript solvers at
the same biased operating point, checks normalized potential and terminal-current
parity, and verifies continuation from a previously converged WASM state.

CSV files contain model and area metadata plus both terminal-current and
current-density columns with units in their headers. PNG export captures the
active plot. Both exports remain disabled unless the current result has
converged.

## Validity limits

Both laboratories omit avalanche and tunneling breakdown, Fermi–Dirac
degeneracy, bandgap narrowing, Auger recombination, field- or doping-dependent
mobility, contact resistance, self-heating, heterojunctions, and transients.
The NPN model is 2D but assumes a uniform extrusion through the configured
depth; it does not resolve three-dimensional current crowding. Consequently,
the absence of breakdown and high-field effects is a model property, not a
prediction for a real device. Results are quantitative only when the solver
converges, the mesh warnings are resolved, and the assumptions are reasonable;
the simulator is not equivalent to an industrial TCAD package.
