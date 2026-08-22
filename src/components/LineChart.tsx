import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Config, Data, Layout, PlotlyHTMLElement } from "plotly.js";
import {
  SCIENTIFIC_PLOT_LINE_WIDTHS,
  createScientificPlotlyConfig,
  createScientificPlotlyLayout,
  prepareScientificPlotlyToolbar,
  ScientificPlotFrame,
  useScientificPlotTheme,
} from "@jorpago2/scientific-ui";
import type { NumericArray } from "../types";
import { cssToken } from "../lib/theme";

export interface ChartSeries {
  label: string;
  values: NumericArray;
  color: string;
  dash?: number[];
  lineWidth?: number;
  showInLegend?: boolean;
}

export interface ChartDomain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface LineChartHandle {
  reset: () => void;
  setDomain: (domain: ChartDomain) => boolean;
  downloadSvg: (filename: string) => Promise<boolean>;
}

interface Props {
  x: NumericArray;
  series: ChartSeries[];
  xLabel: string;
  yLabel: string;
  markerX?: number;
  includeZero?: boolean;
  scale?: "linear" | "log" | "symlog";
  height?: number;
  state?: "empty" | "loading" | "ready" | "error";
  message?: string;
  interactive?: boolean;
  onSelectX?: (value: number) => void;
}

type PlotlyModule = typeof import("plotly.js-cartesian-dist-min").default;

export const LineChart = forwardRef<LineChartHandle, Props>(function LineChart({
  x,
  series,
  xLabel,
  yLabel,
  markerX,
  includeZero = false,
  scale = "linear",
  height = 360,
  state = "ready",
  message = "Awaiting a converged solution",
  interactive = false,
  onSelectX,
}, forwardedRef) {
  const plotRef = useRef<HTMLDivElement>(null);
  const plotlyRef = useRef<PlotlyModule | null>(null);
  const plotReadyRef = useRef(false);
  const [plotly, setPlotly] = useState<PlotlyModule | null>(null);
  const [plotError, setPlotError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [manualDomain, setManualDomain] = useState<ChartDomain | null>(null);
  const carbonPlotTheme = useScientificPlotTheme();
  const plotTheme = useMemo(() => ({
    panel: carbonPlotTheme.background,
    ink: carbonPlotTheme.text,
    grid: carbonPlotTheme.grid,
    axis: carbonPlotTheme.axis,
    marker: cssToken("--color-danger"),
    font: cssToken("--font-body"),
  }), [carbonPlotTheme]);

  useImperativeHandle(forwardedRef, () => ({
    reset: () => setManualDomain(null),
    setDomain(domain) {
      if (![domain.xMin, domain.xMax, domain.yMin, domain.yMax].every(Number.isFinite)
        || domain.xMin >= domain.xMax || domain.yMin >= domain.yMax
        || (scale === "log" && domain.yMin <= 0)) return false;
      setManualDomain(domain);
      return true;
    },
    async downloadSvg(filename) {
      if (!plotlyRef.current || !plotRef.current || !plotReadyRef.current) return false;
      try {
        await plotlyRef.current.downloadImage(plotRef.current, {
          format: "svg",
          filename: filename.replace(/\.svg$/i, ""),
          width: 1400,
          height: 800,
        });
        return true;
      } catch {
        return false;
      }
    },
  }), [scale]);

  useEffect(() => {
    let cancelled = false;
    plotReadyRef.current = false;
    setPlotError(null);
    void import("plotly.js-cartesian-dist-min").then((module) => {
      if (cancelled) return;
      plotlyRef.current = module.default;
      setPlotly(module.default);
    }).catch((error: unknown) => {
      if (!cancelled) setPlotError(error instanceof Error ? error.message : "Plotly could not be loaded.");
    });
    return () => {
      cancelled = true;
      if (plotlyRef.current && plotRef.current) plotlyRef.current.purge(plotRef.current);
    };
  }, [retryToken]);

  useEffect(() => setManualDomain(null), [scale, x]);

  const data = useMemo<Data[]>(() => series.map((line) => {
    const values = Array.from(line.values, Number);
    const y = scale === "symlog" ? values.map(symlog) : values;
    return {
      type: "scatter",
      mode: "lines",
      name: line.label,
      x: Array.from(x, Number),
      y,
      customdata: scale === "symlog" ? values : undefined,
      connectgaps: false,
      showlegend: line.showInLegend !== false,
      line: { color: line.color, width: line.lineWidth ?? SCIENTIFIC_PLOT_LINE_WIDTHS.primary, dash: line.dash?.length ? "dash" : "solid" },
      hovertemplate: scale === "symlog"
        ? `${line.label}: %{customdata:.4g}<extra></extra>`
        : `${line.label}: %{y:.4g}<extra></extra>`,
    };
  }), [scale, series, x]);

  const layout = useMemo<Partial<Layout>>(() => {
    const yRange = manualDomain && (scale === "log"
      ? [Math.log10(manualDomain.yMin), Math.log10(manualDomain.yMax)]
      : scale === "symlog"
        ? [symlog(manualDomain.yMin), symlog(manualDomain.yMax)]
        : [manualDomain.yMin, manualDomain.yMax]);
    const symlogAxis = scale === "symlog" ? symlogTicks(series, manualDomain) : null;
    return {
      autosize: true,
      height,
      margin: { l: 68, r: 20, t: 32, b: 56 },
      paper_bgcolor: "transparent",
      plot_bgcolor: plotTheme.panel,
      font: { family: plotTheme.font, size: 12, color: plotTheme.ink },
      hovermode: "x unified",
      dragmode: interactive ? "pan" : false,
      uirevision: `${xLabel}-${yLabel}-${scale}`,
      xaxis: {
        title: { text: xLabel },
        gridcolor: plotTheme.grid,
        zerolinecolor: plotTheme.axis,
        showline: true,
        linecolor: plotTheme.axis,
        fixedrange: !interactive,
        ...(manualDomain ? { range: [manualDomain.xMin, manualDomain.xMax], autorange: false } : { autorange: true }),
      },
      yaxis: {
        title: { text: yLabel },
        type: scale === "log" ? "log" : "linear",
        gridcolor: plotTheme.grid,
        zerolinecolor: plotTheme.axis,
        showline: true,
        linecolor: plotTheme.axis,
        fixedrange: !interactive,
        rangemode: includeZero && scale === "linear" ? "tozero" : "normal",
        ...(yRange ? { range: yRange, autorange: false } : { autorange: true }),
        ...(symlogAxis ?? {}),
      },
      legend: { orientation: "h", x: 0, y: 1.14 },
      shapes: Number.isFinite(markerX) ? [{
        type: "line",
        x0: markerX,
        x1: markerX,
        y0: 0,
        y1: 1,
        yref: "paper",
        line: { color: plotTheme.marker, width: SCIENTIFIC_PLOT_LINE_WIDTHS.reference, dash: "dash" },
      }] : [],
    };
  }, [height, includeZero, interactive, manualDomain, markerX, plotTheme, scale, series, xLabel, yLabel]);

  useEffect(() => {
    const element = plotRef.current;
    if (!plotly || !element) return;
    plotReadyRef.current = false;
    const config = createScientificPlotlyConfig({
      filename: "scientific-plot",
      scrollZoom: interactive,
      displayModeBar: interactive,
    }) as Partial<Config>;
    const normalizedLayout = createScientificPlotlyLayout({
      height,
      theme: carbonPlotTheme,
      overrides: layout as Record<string, unknown>,
    }) as Partial<Layout>;
    void plotly.react(element, state === "ready" ? data : [], normalizedLayout, config).then((plot) => {
      plotReadyRef.current = true;
      setPlotError(null);
      prepareScientificPlotlyToolbar(plot);
      const interactivePlot = plot as PlotlyHTMLElement;
      interactivePlot.removeAllListeners("plotly_click");
      if (interactive && onSelectX) interactivePlot.on("plotly_click", (event) => {
        const selectedX = Number(event.points[0]?.x);
        if (Number.isFinite(selectedX)) onSelectX(selectedX);
      });
    }).catch((error: unknown) => setPlotError(error instanceof Error ? error.message : "The plot could not be rendered."));
    return () => {
      plotReadyRef.current = false;
    };
  }, [carbonPlotTheme, data, interactive, layout, onSelectX, plotly, state]);

  const accessibleTitle = `${plainPlotText(yLabel)} versus ${plainPlotText(xLabel)}`;
  return (
    <ScientificPlotFrame
      className={`chart-frame chart-${plotError ? "error" : state}`}
      title={accessibleTitle}
      status={plotError ? <span role="alert">Plot unavailable: {plotError}</span> : state !== "ready" ? message : undefined}
      actions={plotError ? <button type="button" onClick={() => setRetryToken((current) => current + 1)}>Retry plot</button> : undefined}
      instructions={interactive ? "Use the external plot controls to pan, zoom and export." : undefined}
    >
      <div className="chart-body" data-message={plotError ?? message} style={{ "--chart-height": `${height}px` } as React.CSSProperties}>
        <div ref={plotRef} className="plotly-chart scientific-plot-surface" role="img" aria-label={accessibleTitle} />
      </div>
      <details className="chart-data-table">
        <summary>Data table</summary>
        <div className="table-scroll" tabIndex={0} aria-label={`${accessibleTitle} data`}><table><thead><tr><th scope="col">{plainPlotText(xLabel)}</th>{series.map((line) => <th scope="col" key={line.label}>{plainPlotText(line.label)}</th>)}</tr></thead><tbody>{Array.from(x, (xValue, index) => <tr key={index}><td>{Number(xValue).toPrecision(6)}</td>{series.map((line) => <td key={line.label}>{Number(line.values[index]).toPrecision(6)}</td>)}</tr>)}</tbody></table></div>
      </details>
    </ScientificPlotFrame>
  );
});

function symlog(value: number): number {
  return Math.sign(value) * Math.log10(1 + Math.abs(value));
}

function plainPlotText(value: string): string {
  return value.replace(/<sub>(.*?)<\/sub>/g, " $1").replace(/<[^>]+>/g, "");
}

function symlogTicks(series: ChartSeries[], domain: ChartDomain | null): Partial<Layout["yaxis"]> {
  const maximum = domain
    ? Math.max(Math.abs(domain.yMin), Math.abs(domain.yMax))
    : Math.max(1, ...series.flatMap((line) => Array.from(line.values, (value) => Math.abs(Number(value))).filter(Number.isFinite)));
  const maximumExponent = Math.max(0, Math.ceil(Math.log10(maximum)));
  const step = Math.max(1, Math.ceil(maximumExponent / 4));
  const values = [0, ...Array.from({ length: Math.floor(maximumExponent / step) + 1 }, (_, index) => 10 ** (index * step))];
  const ticks = [...values.slice(1).reverse().map((value) => -value), ...values];
  return {
    tickmode: "array",
    tickvals: ticks.map(symlog),
    ticktext: ticks.map((value) => value === 0 ? "0" : value.toExponential(0)),
  };
}
