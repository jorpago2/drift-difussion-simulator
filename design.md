# Design — Semiconductor Devices Lab

## Shared contract (normative)

This application consumes `@jorpago2/scientific-ui` and follows the [shared interface contract](https://github.com/jorpago2/jorpago2.github.io/blob/main/docs/interface-contract.md). That contract supersedes conflicting local typography, accent, radius and application-chrome rules below. P/N device colours remain valid only as scientific encodings.

A locked design system for the PN and NPN laboratories. Both pages share one
visual language; device-specific colour is reserved for physical meaning.

## Genre

Modern-minimal technical.

## Macrostructure family

- App pages: Workbench — a compact configuration dock beside a continuous result sheet.
- Mobile app pages: configuration disclosure followed by a single-column result stream.
- Content pages: Long Document if explanatory routes are added later.

## Theme

- Paper: cool green-tinted near-white (`oklch(98% 0.008 170)`).
- Ink: green-tinted graphite (`oklch(21% 0.018 170)`).
- Accent: restrained teal (`oklch(44% 0.12 178)`).
- Device semantics: rose for P-type; blue for N-type; never decorative.
- Full values live in `tokens.css` and must be referenced by token name.

## Typography

- Display: Space Grotesk, weights 600â€“700, normal style.
- Body: IBM Plex Sans, weights 400 and 700.
- Display tracking: `-0.025em`.
- Numerical content uses tabular figures.

## Spacing

Use the 4-point named scale in `tokens.css`. Raw spacing values are reserved for
physical plot dimensions and unavoidable third-party integration details.

## Motion

- Easings: `--ease-out`, `--ease-in`, and `--ease-in-out`.
- Reveal pattern: none; the interface is an instrument, not a presentation.
- Functional solver status may pulse.
- Reduced motion removes spatial animation and retains state changes.

## Microinteractions stance

- Silent success; the visible result and status are the confirmation.
- Button press uses a one-pixel translation.
- Focus rings appear instantly and meet 3:1 contrast.
- Native disclosures carry secondary information.

## CTA voice

- Primary: dark teal fill, compact rectangular control, verb-led label.
- Secondary: tinted near-white surface with a hairline rule.

## Per-page allowances

- App pages use no decorative enrichment.
- Real-device cutaways remain optional scientific context.
- Plots retain domain-specific data colours but share typography and surfaces.

## What pages MUST share

- Header, device switcher, configuration dock, status, control geometry, fonts,
  teal accent, disclosure rhythm, plot surfaces, and responsive behaviour.

## What pages MAY differ on

- P/N device diagram geometry, parameter count, result metrics, scientific plot
  colours, and the number of optional analysis panels.

## Exports

### tokens.css

`tokens.css` at the project root is the canonical source.

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper: oklch(98% 0.008 170);
  --color-paper-2: oklch(96% 0.011 170);
  --color-paper-3: oklch(93% 0.014 170);
  --color-ink: oklch(21% 0.018 170);
  --color-ink-2: oklch(33% 0.018 170);
  --color-rule: oklch(87% 0.012 170);
  --color-muted: oklch(46% 0.014 170);
  --color-accent: oklch(44% 0.12 178);
  --color-focus: oklch(31% 0.13 178);
  --font-display: 'Space Grotesk', ui-sans-serif, sans-serif;
  --font-body: 'IBM Plex Sans', ui-sans-serif, sans-serif;
  --spacing-xs: 0.5rem;
  --spacing-sm: 0.75rem;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --text-sm: 0.875rem;
  --text-md: 1.125rem;
  --radius-card: 8px;
  --radius-input: 6px;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "color": {
    "paper": { "$value": "oklch(98% 0.008 170)", "$type": "color" },
    "ink": { "$value": "oklch(21% 0.018 170)", "$type": "color" },
    "accent": { "$value": "oklch(44% 0.12 178)", "$type": "color" },
    "focus": { "$value": "oklch(31% 0.13 178)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Space Grotesk, ui-sans-serif, sans-serif", "$type": "fontFamily" },
    "body": { "$value": "IBM Plex Sans, ui-sans-serif, sans-serif", "$type": "fontFamily" }
  },
  "space": {
    "sm": { "$value": "0.75rem", "$type": "dimension" },
    "md": { "$value": "1rem", "$type": "dimension" },
    "lg": { "$value": "1.5rem", "$type": "dimension" }
  },
  "duration": {
    "micro": { "$value": "120ms", "$type": "duration" },
    "short": { "$value": "220ms", "$type": "duration" }
  }
}
```

### shadcn/ui CSS variables

```css
:root {
  --background: 98% 0.008 170;
  --foreground: 21% 0.018 170;
  --card: 99% 0.006 170;
  --card-foreground: 21% 0.018 170;
  --popover: 99% 0.006 170;
  --popover-foreground: 21% 0.018 170;
  --primary: 44% 0.12 178;
  --primary-foreground: 98% 0.008 170;
  --secondary: 93% 0.014 170;
  --secondary-foreground: 33% 0.018 170;
  --muted: 87% 0.012 170;
  --muted-foreground: 46% 0.014 170;
  --border: 87% 0.012 170;
  --input: 76% 0.018 170;
  --ring: 31% 0.13 178;
  --radius: 8px;
}
```
