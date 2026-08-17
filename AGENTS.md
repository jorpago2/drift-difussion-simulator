# Drift-Diffusion Simulator

## Carbon y diseño

- Usa la versión instalada de `@carbon/react` y los componentes de Carbon cuando mejoren la interacción, pero no fuerces una composición poco clara.
- Consulta Storybook o la documentación oficial al introducir un componente, resolver una duda de comportamiento o sobrescribir estilos internos; no repitas la comparación para reutilizaciones evidentes.
- Evalúa la interfaz renderizada: jerarquía, proporción, legibilidad, accesibilidad, estados de interacción y comportamiento responsive importan tanto como compilar.

## Propiedad React, Workers y WASM

- React es el único propietario de la estructura, visibilidad, atributos ARIA, estado visual y eventos de los componentes que renderiza.
- Los workers PN/BJT y los backends JavaScript/WebAssembly resuelven el cálculo, pero no deben guardar referencias permanentes ni modificar directamente el DOM de React.
- Comunica la interfaz con los workers mediante sus mensajes y estado de aplicación existentes; las acciones de React deben iniciar, cancelar o seleccionar cálculos a través de esa frontera. No introduzcas eventos globales ni listeners imperativos sobre controles que ya gestiona React.
- Conserva la separación entre resultados numéricos, unidades, diagnósticos y presentación. Los cambios visuales no deben alterar la semántica del solver sin una razón explícita.

## `scientific-ui`

- Corrige por defecto los problemas específicos dentro de este simulador.
- Modifica `scientific-ui` solo cuando la causa pertenezca realmente al componente compartido y la corrección deba propagarse a sus consumidores.
- Al actualizar el paquete vendorizado, cambia conjuntamente `package.json`, `pnpm-lock.yaml` y `vendor/jorpago2-scientific-ui-*.tgz`, y comprueba que el nuevo tarball quede rastreado por Git.

## Camino rápido por defecto

- Atiende una familia concreta de problemas por iteración y evita auditorías generales no solicitadas.
- Para un cambio localizado, inspecciona la implementación relevante, el estado afectado y una resolución representativa adicional.
- Entrega primero una iteración visible y comprobable; amplía el trabajo solo si el resultado o el riesgo lo justifican.
- No ejecutes suites completas, matrices extensas, benchmarks ni validaciones científicas para ajustes visuales localizados.
- Si el diagnóstico crece sin una causa clara, informa de lo comprobado antes de ampliar el alcance.

## Subagentes

- Usa subagentes `gpt-5.6-luna` con razonamiento `max` en paralelo cuando existan partes independientes y la delegación mejore claramente la velocidad, cobertura o calidad.
- Asigna a cada subagente un alcance concreto y sin solapamientos; el agente principal conserva la integración y la verificación final.
- Evita que varios subagentes editen simultáneamente el mismo archivo. Revisa siempre el diff y el estado integrado; no des por válida una comprobación declarada por un subagente sin verificar el resultado final.
- No uses subagentes para cambios pequeños, secuenciales o fuertemente acoplados cuando coordinar cueste más que resolverlos directamente.

## Verificación proporcional

- Para tareas visuales o de interacción, usa `$browser:control-in-app-browser` cuando esté disponible y comprueba la pantalla y el flujo afectado antes y después del cambio.
- Reutiliza `pnpm dev` y HMR durante la iteración. No reconstruyas producción después de cada ajuste.
- Cambio visual localizado: navegador interno y la resolución afectada.
- Cambio React/TypeScript: `pnpm typecheck` y el flujo afectado.
- Cambio en workers, backends o WASM: `pnpm test`; si cambia el código nativo correspondiente, regenera con `pnpm build:wasm` o `pnpm build:bjt-wasm` según el backend afectado.
- Cambio de pruebas de navegador: `pnpm test:ui`.
- Integración o publicación: `pnpm build` cuando el cambio esté integrado o antes de publicarlo.
- Usa `pnpm start`, `pnpm preview`, `pnpm storybook` o `pnpm build-storybook` solo cuando el flujo concreto lo requiera; son comandos reales del proyecto.
- Mantén separadas la validez física del simulador y la calidad visual salvo que el cambio afecte a ambas. Informa solo de verificaciones ejecutadas.
