# Design — Semiconductor Devices Lab

## Shared contract (normative)

This application consumes `@jorpago2/scientific-ui` and follows the [shared interface contract](https://github.com/jorpago2/jorpago2.github.io/blob/main/docs/interface-contract.md). Carbon `g10`, IBM Plex, square geometry, shared workbench chrome and shared responsive behaviour are mandatory.

## Scientific exceptions

- Rose and blue encode P-type and N-type regions, carriers and device geometry; they are never application accents.
- Plot and heat-map palettes remain local scientific encodings and always include labels, units and textual interpretation.
- PN and NPN pages may expose different physical parameters and result groups while retaining the same header, task panel, navigation, status and control hierarchy.
- Solver progress, convergence limits and numerical warnings must remain explicit and must not rely on colour alone.
