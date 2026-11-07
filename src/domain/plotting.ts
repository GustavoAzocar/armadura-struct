import type { DrawingStyle, PlotSettings, Primitive, Project } from './types';
import { layerId, resolveStyle, mergePlotStyle } from './layers';
import { plotSettingsSchema } from './layerSchema';

export const PLOT_LINE_TYPES = [
  { name: 'CONTINUOUS', pattern: [] },
  { name: 'DASHED', pattern: [2, -1] },
  { name: 'DOTTED', pattern: [0, -0.8] },
  { name: 'DASHDOT', pattern: [2, -0.6, 0, -0.6] },
];
export const plotSettings = (p: Pick<Project, 'plotting'>): PlotSettings =>
  p.plotting ?? { preset: 'color', referenceScale: 50 };
export function setPlotSettings(p: Project, value: PlotSettings): Project {
  return { ...p, plotting: plotSettingsSchema.parse(value) };
}
export function plotColor(p: Pick<Project, 'plotting'>, color: string) {
  const { preset } = plotSettings(p);
  if (preset === 'color') return color;
  // Keep explicit white backgrounds white, including in monochrome.
  if (color.toLowerCase() === '#ffffff') return color;
  if (preset === 'monochrome') return '#000000';
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const gray = Math.round(rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722)
    .toString(16)
    .padStart(2, '0');
  return `#${gray}${gray}${gray}`;
}
/** The single print resolver, shared by preview, vector PDF and DXF.
 * Screen patterns inherited from AS-19 are normalized at 1:50; explicit plot
 * patterns already use paper mm. DXF model space expands those paper lengths
 * by referenceScale, without transforming any physical geometry.
 */
export function resolvePlotStyle(
  p: Pick<Project, 'layers' | 'plotting'>,
  item: Primitive,
  inputSpace: 'model' | 'paper' = 'model',
): { include: boolean; style: DrawingStyle } {
  const role = item.role ?? item.layer;
  const layer = p.layers.find((l) => l.id === (item.layerId ?? layerId(role)));
  const base =
    item.resolvedStyle ??
    (layer
      ? resolveStyle(p, item, role)
      : {
          color: role === 'SELO' ? '#3448d1' : '#263044',
          fillColor: '#263044',
          fill: 'none' as const,
          lineWidth: ['MARGEM', 'SELO'].includes(role) ? 0.25 : 0.18,
          lineScale: 1,
          lineType: { name: 'CONTINUOUS', pattern: [] },
        });
  const inherited = {
    ...base,
    lineType: {
      ...base.lineType,
      pattern: base.lineType.pattern.map(
        (n) => n / (inputSpace === 'model' ? 50 : 1),
      ),
    },
  };
  const style = { ...inherited, ...mergePlotStyle(layer?.plot, item.plot) };
  return {
    include: layer?.plot?.include !== false && item.plot?.include !== false,
    style: {
      ...style,
      color: plotColor(p, style.color),
      fillColor: plotColor(p, style.fillColor),
    },
  };
}
export function plotPrimitives(
  p: Pick<Project, 'layers' | 'plotting'>,
  items: Primitive[],
  output: 'paper' | 'dxf' = 'paper',
  inputSpace: 'model' | 'paper' = 'model',
): Primitive[] {
  return items.flatMap((item) => {
    const resolved = resolvePlotStyle(p, item, inputSpace);
    if (!resolved.include) return [];
    const style =
      output === 'dxf'
        ? {
            ...resolved.style,
            lineType: {
              ...resolved.style.lineType,
              pattern: resolved.style.lineType.pattern.map(
                (n) => n * plotSettings(p).referenceScale,
              ),
            },
          }
        : resolved.style;
    return [{ ...item, resolvedStyle: style }];
  });
}
