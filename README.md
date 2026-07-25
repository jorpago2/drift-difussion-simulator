# 1D PN Junction Laboratory

A dependency-free teaching simulator for a stationary, one-dimensional silicon
PN junction. The interface guides students through four stages:
**Device → Solve → Results → Validate**. Before the solver runs, the application
shows only the physical structure; an initial condition is never presented as a
converged solution.

The main application uses only the 1D PN model. The previous 2D, MOS, NPN, and
WASM implementations remain in the repository as experimental code, outside
the public v1 workflow and validation scope.

## Run

A recent Node.js version is required only to serve the ES modules and run the
self-check:

```powershell
node scripts\serve-static.mjs
```

Open `http://127.0.0.1:8769/`. To verify the numerical core:

```powershell
node scripts\self-check.mjs
```

When `npm` is available, `npm start` and `npm test` are equivalent aliases. No
WASM compilation or package installation is required.

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
- `sweepPnJunction(config, voltages?)` generates the J–V sweep.
- `shockleyReferenceCurrentDensity(config, voltage)` provides an independent
  low-injection analytical reference.

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
```

Core quantities use SI units. The interface converts current density from A/m²
to A/cm²; it never displays total current without a defined device area.

## Parameters and warnings

Defaults: 300 K, εr = 11.7, ni = 10¹⁰ cm⁻³, Eg = 1.12 eV,
μn = 1350 cm²/(V·s), μp = 480 cm²/(V·s), NA = ND = 10¹⁶ cm⁻³,
4 µm length, τn = τp = 10 ns, and 401 nodes.

Inputs are restricted to:

| Parameter | Range |
|---|---:|
| NA, ND | 10¹⁴–10¹⁸ cm⁻³ |
| Length | 1–20 µm |
| VD | −1–0.8 V |
| Odd mesh | 101–2001 nodes |
| τn, τp | 10⁻¹²–10⁻³ s |

The preflight warns when the spatial step does not adequately resolve the
shortest Debye length or estimated depletion width. A warning does not imply
convergence; the four diagnostics above determine whether a result may be
displayed and exported.

## Interpretation and validation

The **Validate** stage compares the built-in potential against
`V_T ln(NA ND / ni²)`, checks spatial current conservation, reports all three
residuals, and summarizes mesh adequacy. The Shockley curve is deliberately
independent of the solver and appears only in the low-injection range; agreement
with it is not a convergence criterion.

`scripts/self-check.mjs` verifies the Bernoulli function, neutrality, mass
action, built-in potential, equilibrium current and SRH, convergence at −0.5,
0, 0.3, and 0.6 V, J–V sign and monotonicity, current conservation,
201/401/801-node refinement, invalid-input rejection, and CSV serialization.
The refinement criterion requires less than 2% difference between the 401- and
801-node meshes.

CSV files contain metadata and units in every header. PNG export captures the
active plot. Both exports remain disabled unless the current result has
converged.

## Validity limits

Version 1 omits avalanche and tunneling breakdown, Fermi–Dirac degeneracy,
bandgap narrowing, Auger recombination, field- or doping-dependent mobility,
heterojunctions, transients, and 2D geometries. Consequently, the absence of
reverse-bias breakdown is a model property, not a prediction for a real device.
The simulator is quantitative only when it converges, the mesh is adequate,
and the assumptions above are reasonable; it is not equivalent to an
industrial TCAD package.
