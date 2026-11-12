import { barDimensions } from './barDimensions';
import { formatDimension } from './dimensionPresentation';
import type { Bar, BarDimensionConvention, Point } from './types';

/**
 * Explicit automatic labels. Undefined hands the caller back to its legacy
 * rendering, including specialized labels on families without this convention.
 * Values come from the local bar; callers transform only the text anchor.
 */
export function barConventionLabels(
  bar: Bar,
  convention: BarDimensionConvention | undefined,
  options: { representation?: boolean; paperHeight?: number } = {},
): { text: string; at: Point }[] | undefined {
  if (!convention) return undefined;
  const dimensions = barDimensions(bar);
  if (!dimensions.axis.length) return undefined;

  const external =
    convention === 'external' && dimensions.status === 'available';
  const labels = external ? dimensions.external : dimensions.axis;
  const suffix = external ? 'ext.' : 'eixo';
  return labels.map(({ length }, i) => {
    const { from, to } = dimensions.axis[i];
    const at = {
      x: (from.point.x + to.point.x) / 2,
      y: (from.point.y + to.point.y) / 2,
    };
    if (bar.kind === 'stirrup' && bar.stirrupProfile) {
      const sign = bar.stirrupMirrored ? -1 : 1;
      if (i === 0) at.y = dimensions.axis[1].to.point.y + sign * 45;
      else at.x -= 60;
    } else if (bar.kind === 'stirrup' && !options.representation) {
      if (i === 0) {
        at.y =
          bar.height +
          (options.paperHeight === undefined ? 45 : options.paperHeight * 1.1);
      } else {
        at.x = -(options.paperHeight === undefined
          ? 60
          : options.paperHeight * 1.2);
      }
    } else if (bar.kind === 'stirrup') {
      at.y += (i === 0 ? dimensions.axis[1].to.point.y : 0) + 40;
    } else {
      at.y += 40;
    }
    return {
      text: `${formatDimension(length, { unit: 'cm', precision: 1 })} (${suffix})`,
      at,
    };
  });
}
