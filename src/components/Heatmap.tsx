import { useEffect, useMemo, useRef, useState } from "react";
import type { Config, Data, Layout } from "plotly.js";
import {
  createScientificPlotlyConfig,
  createScientificPlotlyLayout,
  prepareScientificPlotlyToolbar,
  useScientificPlotTheme,
} from "@jorpago2/scientific-ui";
import type { NumericArray } from "../types";
import { cssToken } from "../lib/theme";

interface Props {
  values?: NumericArray;
  nx?: number;
  ny?: number;
  lengthUm?: number;
  heightUm?: number;
  label: string;
  diverging?: boolean;
  transform?: (value: number, index: number) => number;
}

type PlotlyModule = typeof import("plotly.js-cartesian-dist-min").default;

export function Heatmap({ values, nx = 0, ny = 0, lengthUm = 1, heightUm = 1, label, diverging = false, transform }: Props) {
  const plotRef = useRef<HTMLDivElement>(null);
  const plotlyRef = useRef<PlotlyModule | null>(null);
  const [plotly, setPlotly] = useState<PlotlyModule | null>(null);
  const carbonPlotTheme = useScientificPlotTheme();
  const plotTheme = useMemo(() => ({
    panel: carbonPlotTheme.background,
    ink: carbonPlotTheme.text,
    axis: carbonPlotTheme.axis,
    font: cssToken("--font-body"),
    diverging: [
      cssToken("--color-map-cold-3"),
      cssToken("--color-map-cold-2"),
      cssToken("--color-map-cold-1"),
      cssToken("--color-map-zero"),
      cssToken("--color-map-warm-1"),
      cssToken("--color-map-warm-2"),
      cssToken("--color-map-warm-3"),
    ],
  }), [carbonPlotTheme]);

  const data = useMemo<Data[]>(() => {
    if (!values || !nx || !ny || values.length !== nx * ny) return [];
    const plotted = Array.from(values, (value, index) => transform ? transform(Number(value), index) : Number(value));
    let minimum = Math.min(...plotted.filter(Number.isFinite));
    let maximum = Math.max(...plotted.filter(Number.isFinite));
    if (diverging) {
      const extent = Math.max(Math.abs(minimum), Math.abs(maximum), Number.MIN_VALUE);
      minimum = -extent;
      maximum = extent;
    }
    return [{
      type: "heatmap",
      x: Array.from({ length: nx }, (_, index) => nx > 1 ? index * lengthUm / (nx - 1) : 0),
      y: Array.from({ length: ny }, (_, index) => ny > 1 ? index * heightUm / (ny - 1) : 0),
      z: Array.from({ length: ny }, (_, row) => plotted.slice(row * nx, (row + 1) * nx)),
      zmin: minimum,
      zmax: maximum > minimum ? maximum : minimum + 1,
      zmid: diverging ? 0 : undefined,
      colorscale: diverging
        ? [[0, plotTheme.diverging[0]!], [0.2, plotTheme.diverging[1]!], [0.4, plotTheme.diverging[2]!], [0.5, plotTheme.diverging[3]!], [0.6, plotTheme.diverging[4]!], [0.8, plotTheme.diverging[5]!], [1, plotTheme.diverging[6]!]]
        : "Cividis",
      colorbar: { title: { text: label }, thickness: 12 },
      hovertemplate: `x: %{x:.4g} µm<br>y: %{y:.4g} µm<br>${label}: %{z:.4g}<extra></extra>`,
    }];
  }, [diverging, heightUm, label, lengthUm, nx, ny, plotTheme, transform, values]);

  useEffect(() => {
    let cancelled = false;
    void import("plotly.js-cartesian-dist-min").then((module) => {
      if (cancelled) return;
      plotlyRef.current = module.default;
      setPlotly(module.default);
    });
    return () => {
      cancelled = true;
      if (plotlyRef.current && plotRef.current) plotlyRef.current.purge(plotRef.current);
    };
  }, []);

  useEffect(() => {
    const element = plotRef.current;
    if (!plotly || !element) return;
    const layout: Partial<Layout> = {
      autosize: true,
      height: 260,
      margin: { l: 58, r: 68, t: 12, b: 48 },
      paper_bgcolor: "transparent",
      plot_bgcolor: plotTheme.panel,
      font: { family: plotTheme.font, size: 11, color: plotTheme.ink },
      xaxis: { title: { text: "x (µm)" }, gridcolor: plotTheme.panel, showline: true, linecolor: plotTheme.axis },
      yaxis: { title: { text: "y (µm)" }, autorange: "reversed", gridcolor: plotTheme.panel, showline: true, linecolor: plotTheme.axis },
    };
    const config = createScientificPlotlyConfig({ filename: "field-map", format: "png", scrollZoom: true }) as Partial<Config>;
    const normalizedLayout = createScientificPlotlyLayout({
      height: 260,
      theme: carbonPlotTheme,
      overrides: layout as Record<string, unknown>,
    }) as Partial<Layout>;
    void plotly.react(element, data, normalizedLayout, config).then(prepareScientificPlotlyToolbar);
  }, [carbonPlotTheme, data, plotTheme, plotly]);

  return <div ref={plotRef} className="heatmap-plot scientific-plot-surface" role="img" aria-label={label} />;
}
