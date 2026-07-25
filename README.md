# Laboratorio de unión PN 1D

Simulador docente, sin dependencias de ejecución, de una unión PN de silicio
unidimensional y estacionaria. La interfaz guía el trabajo en cuatro etapas:
**Dispositivo → Resolver → Resultados → Validar**. Antes de resolver solo se
muestra el esquema físico; una condición inicial nunca se presenta como una
solución convergida.

La aplicación principal usa exclusivamente el modelo PN 1D. Los modelos 2D,
MOS, NPN y el antiguo kernel WASM se conservan en el repositorio como código
experimental, pero no forman parte del flujo público ni de la validación v1.

## Ejecución

Requiere una versión reciente de Node.js únicamente para servir los módulos
ES y ejecutar el autocontrol:

```powershell
node scripts\serve-static.mjs
```

Abra `http://127.0.0.1:8769/`. Para verificar el núcleo:

```powershell
node scripts\self-check.mjs
```

Si `npm` está disponible, `npm start` y `npm test` son alias equivalentes.

No es necesario compilar WASM ni instalar paquetes.

## Modelo físico

El dominio contiene una unión abrupta centrada, contactos óhmicos y cátodo a
0 V. La convención de polarización es

```text
V_D = V_A - V_C.
```

El núcleo resuelve autoconsistentemente Poisson y las continuidades
estacionarias:

```text
d/dx (ε dψ/dx) = -q (p - n + N_D - N_A)
dJ_n/dx =  q R_SRH
dJ_p/dx = -q R_SRH
```

Los flujos electrónicos y de huecos se discretizan con
Scharfetter–Gummel. La recombinación utiliza una trampa SRH a mitad de banda:

```text
R_SRH = (np - n_i²) /
        [τ_p (n + n_i) + τ_n (p + n_i)].
```

Se supone silicio no degenerado, ionización completa, estadística de
Boltzmann, permitividad y movilidades constantes. Las bandas y cuasi-niveles
de Fermi son energías relativas; su cero es arbitrario.

## Método numérico

`src/ddm-core.js` expone la API pública:

- `validatePnConfig(config)` valida rangos y estima `V_bi`, anchura de
  agotamiento, longitudes de Debye y paso espacial.
- `solvePnJunction1D(config, previousSolution?)` resuelve un punto de tensión.
- `sweepPnJunction(config, voltages?)` genera el barrido J–V.
- `shockleyReferenceCurrentDensity(config, voltage)` calcula solo la referencia
  analítica de baja inyección.

El equilibrio se obtiene primero mediante Poisson–Boltzmann. Cada tensión se
alcanza por continuación con pasos no mayores de 25 mV. La iteración de
Gummel combina sistemas tridiagonales, variables de Slotboom para las
continuidades, linealización local de SRH y amortiguamiento adaptativo. Cada
punto admite hasta 200 iteraciones y falla explícitamente si no satisface:

```text
residuo de Poisson       < 1e-8
residuo de electrones   < 1e-8
residuo de huecos       < 1e-8
no uniformidad de J     < 1e-3
```

Las magnitudes del núcleo están en SI. La interfaz convierte densidad de
corriente de A/m² a A/cm²; no se muestra una corriente total sin definir área.

## Parámetros y advertencias

Valores iniciales: 300 K, εr = 11.7, ni = 10¹⁰ cm⁻³, Eg = 1.12 eV,
μn = 1350 cm²/(V·s), μp = 480 cm²/(V·s), NA = ND = 10¹⁶ cm⁻³,
longitud de 4 µm, τn = τp = 10 ns y 401 nodos.

La entrada se restringe a:

| Parámetro | Intervalo |
|---|---:|
| NA, ND | 10¹⁴–10¹⁸ cm⁻³ |
| Longitud | 1–20 µm |
| VD | −1–0.8 V |
| Malla impar | 101–2001 nodos |
| τn, τp | 10⁻¹²–10⁻³ s |

El preflight advierte si el paso espacial no describe suficientemente la
menor longitud de Debye o la anchura de agotamiento estimada. Una advertencia
no equivale a convergencia; los cuatro diagnósticos anteriores deciden si el
resultado puede mostrarse y exportarse.

## Interpretación y validación

La etapa **Validar** compara el potencial incorporado con
`V_T ln(NA ND / ni²)`, comprueba conservación espacial de corriente, muestra
los tres residuos y resume la adecuación de malla. La referencia Shockley es
deliberadamente independiente del solver y solo se dibuja en baja inyección;
su acuerdo no es un criterio de convergencia.

`scripts/self-check.mjs` verifica Bernoulli, neutralidad, ley de acción de
masas, potencial incorporado, corriente y SRH de equilibrio, convergencia en
−0.5, 0, 0.3 y 0.6 V, signo y monotonicidad J–V, conservación de corriente,
refinamiento 201/401/801, rechazo de entradas inválidas y serialización CSV.
El criterio de refinamiento exige menos de 2 % entre 401 y 801 nodos.

Los CSV incluyen metadatos y unidades en cada cabecera. El PNG corresponde a
la figura activa. Ambas exportaciones permanecen deshabilitadas si el punto
actual no ha convergido.

## Límites de validez

Esta v1 no incluye ruptura por avalancha o túnel, degeneración de
Fermi–Dirac, estrechamiento de banda, Auger, movilidad dependiente de campo o
dopaje, heterouniones, transitorios ni geometrías 2D. En inversa, por tanto,
la ausencia de ruptura es una propiedad del modelo, no una predicción del
dispositivo real. El simulador es cuantitativo solo cuando converge, la malla
es adecuada y los supuestos anteriores son razonables; no pretende
equivalencia con un TCAD industrial.
