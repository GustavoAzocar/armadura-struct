import {
  stirrupPrimitives,
  stirrupDimensionLabels,
  displayedBarGeometry,
} from './stirrupGeometry';
import { barConventionLabels } from './barDimensionLabels';
import { geometry, sampled, rotate, format } from './geometry';
import {
  beamClampPrimitives,
  beamClampViewPoints,
  beamClampDimensionLabels,
  beamClampDimensionPrimitives,
  beamClampLabelOrigin,
} from './beamClampViews';
import {
  helixPrimitives,
  helixViewPoints,
  helixCaption,
  helixDimensionLabels,
  helixDimensionPrimitives,
  helixLabelOrigin,
} from './helixViews';
import { quantityLabel, assemblyLabel } from './detailQuantities';
import { barCaption } from './drafting';
import type { Bar, Detail, Point, Primitive, Project } from './types';
export function representationPoint(d: Detail, p: Point): Point {
  const v = rotate(
    {
      x: p.x * (d.scale ?? 1),
      y: p.y * (d.scale ?? 1) * (d.mirrored ? -1 : 1),
    },
    d.rotation ?? 0,
  );
  return { x: v.x + d.origin.x, y: v.y + d.origin.y };
}
export function representationPoints(b: Bar, d: Detail) {
  if (b.kind === 'beam-clamp')
    return beamClampViewPoints(b, d.beamClampView ?? b.beamClampView).map((p) =>
      representationPoint(d, p),
    );
  if (b.kind === 'helix')
    return helixViewPoints(b).map((p) => representationPoint(d, p));
  return sampled((displayedBarGeometry(b) ?? geometry(b)).segments).map((p) =>
    representationPoint(d, p),
  );
}
export function showsPhysicalDescription(p: Project, id: string) {
  return !p.details.some(
    (d) => d.barId === id && d.identification === 'primary',
  );
}
export function representationPrimitives(
  b: Bar,
  d: Detail,
  p: Project,
  paperHeight?: number,
): Primitive[] {
  const h = paperHeight ?? d.drafting?.height ?? 40;
  const text = (
    text: string,
    at: Point,
    layer: string,
    align = d.drafting?.align,
  ): Primitive => ({
    layer,
    text,
    points: [representationPoint(d, at)],
    textHeight:
      (layer === 'COTAS'
        ? (paperHeight ?? d.drafting?.dimensionHeight ?? h)
        : h) * (d.scale ?? 1),
    textAlign: align,
    textRotation: d.rotation ?? 0,
  });
  if (b.kind === 'helix') {
    const out = helixPrimitives(
      b,
      (q) => representationPoint(d, q),
      d.scale ?? 1,
    ).map((q) => ({
      ...q,
      layer: q.layer === 'ARMADURAS' ? 'REBATIMENTOS' : q.layer,
    }));
    const mode = d.identification ?? 'legacy';
    const shown = mode !== 'none' && b.helixDisplay?.identification !== false;
    if (shown) {
      const mark =
        d.label?.omitPrefix && b.mark.startsWith(d.label.omitPrefix)
          ? b.mark.slice(d.label.omitPrefix.length)
          : b.mark;
      const caption = mode === 'mark' ? mark : helixCaption(b, p, mark);
      out.push(
        d.label
          ? {
              layer: 'IDENTIFICACAO',
              points: [representationPoint(d, d.label.origin)],
              text: caption,
              textHeight: d.label.height * (d.scale ?? 1),
              textRotation:
                d.label.rotation * (d.mirrored ? -1 : 1) + (d.rotation ?? 0),
              textAlign: 'center',
            }
          : text(caption, helixLabelOrigin(b), 'IDENTIFICACAO'),
      );
    }
    if (d.showDimensions !== false && b.helixDisplay?.dimensions !== false) {
      out.push(
        ...helixDimensionPrimitives(b, (q) => representationPoint(d, q)),
      );
      for (const value of helixDimensionLabels(b))
        out.push(text(value.text, value.at, 'COTAS', value.align));
    }
    return out;
  }
  const out: Primitive[] =
    b.kind === 'beam-clamp'
      ? beamClampPrimitives(
          b,
          d.beamClampView ?? b.beamClampView,
          (p) => representationPoint(d, p),
          d.scale ?? 1,
          !!d.mirrored,
        ).map((p) => ({ ...p, layer: 'REBATIMENTOS' }))
      : b.stirrupProfile
        ? stirrupPrimitives(
            b,
            (p) => representationPoint(d, p),
            d.scale ?? 1,
            !!d.mirrored,
          ).map((p) => ({ ...p, layer: 'REBATIMENTOS' }))
        : [{ layer: 'REBATIMENTOS', points: representationPoints(b, d) }];
  const mode = d.identification ?? 'legacy';
  if (
    d.label &&
    mode !== 'none' &&
    b.stirrupDisplay?.identification !== false &&
    b.beamClampDisplay?.identification !== false
  ) {
    const mark =
      d.label.omitPrefix && b.mark.startsWith(d.label.omitPrefix)
        ? b.mark.slice(d.label.omitPrefix.length)
        : b.mark;
    out.push({
      layer: 'IDENTIFICACAO',
      points: [representationPoint(d, d.label.origin)],
      text:
        mode === 'mark'
          ? mark
          : barCaption(
              {
                ...b,
                mark,
                comment: undefined,
                columnLevel: undefined,
                showRibbed: false,
              },
              p,
            ),
      textHeight: d.label.height * (d.scale ?? 1),
      textRotation:
        d.label.rotation * (d.mirrored ? -1 : 1) + (d.rotation ?? 0),
      textAlign: 'center',
    });
  }
  if (
    mode !== 'none' &&
    !d.label &&
    b.stirrupDisplay?.identification !== false &&
    b.beamClampDisplay?.identification !== false
  )
    out.push(
      text(
        mode === 'mark'
          ? b.mark
          : `${b.mark} - ${quantityLabel(p, b)} x %%c${b.diameter} - C=${format(geometry(b).length / 10)} cm${assemblyLabel(b) ? ` · ${assemblyLabel(b)}` : ''}`,
        b.kind === 'beam-clamp'
          ? beamClampLabelOrigin(b, d.beamClampView ?? b.beamClampView)
          : { x: 0, y: -110 },
        'IDENTIFICACAO',
      ),
    );
  if (b.kind === 'beam-clamp') {
    if (
      d.showDimensions !== false &&
      b.beamClampDisplay?.dimensions !== false
    ) {
      out.push(
        ...beamClampDimensionPrimitives(
          b,
          d.beamClampView ?? b.beamClampView,
          (point) => representationPoint(d, point),
        ),
      );
      for (const value of beamClampDimensionLabels(
        b,
        d.beamClampView ?? b.beamClampView,
      ))
        out.push(text(value.text, value.at, 'COTAS', value.align));
    }
    return out;
  }
  if (d.showDimensions === false || b.stirrupDisplay?.dimensions === false)
    return out;
  const convention = barConventionLabels(b, d.dimensionConvention, {
    representation: true,
  });
  if (convention) {
    for (const v of convention) out.push(text(v.text, v.at, 'COTAS'));
    return out;
  }
  if (b.stirrupProfile) {
    for (const v of stirrupDimensionLabels(b))
      out.push(text(v.text, v.at, 'COTAS'));
    return out;
  }
  const v = geometry(b).vertices;
  for (let i = 0; i < v.length - 1; i++) {
    if (b.kind === 'stirrup' && ![3, 4].includes(i)) continue;
    const a = v[i],
      c = v[i + 1];
    out.push(
      text(
        format(Math.hypot(a.x - c.x, a.y - c.y) / 10),
        { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 + 40 },
        'COTAS',
      ),
    );
  }
  return out;
}
