import DxfParser from 'dxf-parser';
import { add, mul, rotate, sub } from '../domain/geometry';
import { uid, type Mask, type Point, type Primitive } from '../domain/types';
// The two CAD readers use different entity interfaces. Normalize only at this boundary.
type Raw = Record<string, any>;
type Transform = (p: Point) => Point;
const units: Record<number, [string, number]> = {
  1: ['pol', 25.4],
  2: ['ft', 304.8],
  4: ['mm', 1],
  5: ['cm', 10],
  6: ['m', 1000],
  7: ['km', 1000000],
  14: ['dm', 100],
};
export function parseDxf(text: string, name: string): Mask {
  if (text.startsWith('AutoCAD Binary DXF'))
    throw new Error(
      'DXF binário: salve uma cópia em DXF ASCII para usar como máscara.',
    );
  const d = new DxfParser().parseSync(text);
  if (!d) throw new Error('DXF vazio ou inválido.');
  return normalizeCad(d as unknown as Raw, name, 'DXF');
}
function arc(center: Point, r: number, a: number, angle: number) {
  const n = Math.min(
    512,
    Math.max(8, Math.ceil(Math.abs(angle) / (Math.PI / 36))),
  );
  return Array.from({ length: n + 1 }, (_, i) =>
    add(center, {
      x: r * Math.cos(a + (angle * i) / n),
      y: r * Math.sin(a + (angle * i) / n),
    }),
  );
}
function polyline(v: Raw[], closed: boolean): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < v.length; i++) {
    const a = v[i].location ?? v[i].point ?? v[i],
      b =
        v[(i + 1) % v.length]?.location ??
        v[(i + 1) % v.length]?.point ??
        v[(i + 1) % v.length];
    out.push({ x: a.x, y: a.y });
    const bulge = v[i].bulge ?? 0;
    if (bulge && b && (i < v.length - 1 || closed)) {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        chord = Math.hypot(dx, dy);
      const center = {
        x: (a.x + b.x) / 2 - (dy * (1 - bulge * bulge)) / (4 * bulge),
        y: (a.y + b.y) / 2 + (dx * (1 - bulge * bulge)) / (4 * bulge),
      };
      const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
      out.push(
        ...arc(
          center,
          radius,
          Math.atan2(a.y - center.y, a.x - center.x),
          4 * Math.atan(bulge),
        ).slice(1),
      );
    }
  }
  return out;
}
export function normalizeCad(
  db: Raw,
  name: string,
  format: 'DXF' | 'DWG',
): Mask {
  const primitives: Primitive[] = [];
  const omitted: Record<string, number> = {};
  const warnings: string[] = [];
  const unitCode = Number(db.header?.$INSUNITS ?? db.header?.INSUNITS ?? 0),
    [sourceUnit, scale] = units[unitCode] ?? ['não declarada', 1];
  if (!units[unitCode])
    warnings.push(
      'Unidade não reconhecida: confira a escala da máscara. Foi adotado 1 unidade = 1 mm.',
    );
  const blocks: Record<string, Raw> = { ...db.blocks };
  for (const b of db.tables?.BLOCK_RECORD?.entries ?? []) blocks[b.name] = b;
  let visited = 0;
  const missing = (type: string) => {
    omitted[type] = (omitted[type] ?? 0) + 1;
  };
  const walk = (
    entities: Raw[],
    transform: Transform,
    depth: number,
    parentLayer = '0',
  ) => {
    if (depth > 12) {
      missing('bloco recursivo');
      return;
    }
    for (const original of entities) {
      const e =
        format === 'DWG' &&
        ['ATTRIB', 'ATTDEF'].includes(original.type) &&
        typeof original.text === 'object'
          ? { ...original, ...original.text }
          : original;
      if (++visited > 100000)
        throw new Error(
          'O desenho excede o limite de 100 mil entidades expandidas desta versão.',
        );
      if (e.inPaperSpace || e.isInPaperSpace) continue;
      const type = String(e.type),
        layer = e.layer && e.layer !== '0' ? String(e.layer) : parentLayer;
      let points: Point[] = [];
      let closed = false;
      let text: string | undefined;
      let textHeight: number | undefined;
      let textRotation: number | undefined;
      const normal = e.extrusionDirection ?? {
        x: e.extrusionDirectionX ?? 0,
        y: e.extrusionDirectionY ?? 0,
        z: e.extrusionDirectionZ ?? 1,
      };
      if (Math.abs(normal.x) > 1e-8 || Math.abs(normal.y) > 1e-8) {
        missing(`${type} em plano 3D`);
        continue;
      }
      if (type === 'INSERT' || type === 'DIMENSION') {
        const block = blocks[e.name ?? e.block];
        if (!block) {
          missing(`${type} sem bloco`);
          continue;
        }
        const base = block.position ?? block.basePoint ?? { x: 0, y: 0 };
        const pos = e.position ?? e.insertionPoint ?? { x: 0, y: 0 };
        const deg = (e.rotation ?? 0) * (format === 'DWG' ? 180 / Math.PI : 1);
        const rows = Math.min(1000, e.rowCount || 1),
          cols = Math.min(1000, e.columnCount || 1);
        for (let row = 0; row < rows; row++)
          for (let col = 0; col < cols; col++) {
            const child: Transform = (p) => {
              const q = sub(p, base);
              let v = add(
                pos,
                rotate(
                  {
                    x: q.x * (e.xScale ?? 1) + col * (e.columnSpacing ?? 0),
                    y: q.y * (e.yScale ?? 1) + row * (e.rowSpacing ?? 0),
                  },
                  deg,
                ),
              );
              if (normal.z < 0) v = { x: -v.x, y: v.y };
              return transform(v);
            };
            walk(block.entities ?? [], child, depth + 1, layer);
          }
        continue;
      }
      if (type === 'LINE') points = e.vertices ?? [e.startPoint, e.endPoint];
      else if (
        ['LWPOLYLINE', 'POLYLINE', 'POLYLINE2D', 'POLYLINE3D'].includes(type)
      ) {
        closed = !!(e.shape || (e.flag ?? 0) & 1);
        points = polyline(e.vertices ?? [], closed);
      } else if (type === 'ARC' || type === 'CIRCLE') {
        const start = type === 'CIRCLE' ? 0 : e.startAngle;
        let span = type === 'CIRCLE' ? Math.PI * 2 : e.endAngle - start;
        while (span <= 0) span += Math.PI * 2;
        points = arc(e.center, e.radius, start, span);
        closed = type === 'CIRCLE';
      } else if (type === 'ELLIPSE') {
        const major = e.majorAxisEndPoint;
        const n = 96;
        let span = (e.endAngle ?? Math.PI * 2) - (e.startAngle ?? 0);
        if (span <= 0) span += Math.PI * 2;
        points = Array.from({ length: n + 1 }, (_, i) => {
          const t = (e.startAngle ?? 0) + (span * i) / n;
          return add(e.center, {
            x: major.x * Math.cos(t) - major.y * e.axisRatio * Math.sin(t),
            y: major.y * Math.cos(t) + major.x * e.axisRatio * Math.sin(t),
          });
        });
      } else if (['TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF'].includes(type)) {
        points = [e.startPoint ?? e.position ?? e.insertionPoint];
        text = String(e.text ?? '')
          .replace(/\\P/g, ' ')
          .replace(/\\[A-Za-z][^;]*;/g, '')
          .replace(/[{}]/g, '')
          .replace(/%%c/gi, 'Ø');
        textHeight = e.textHeight ?? e.height ?? 2.5;
        textRotation =
          (e.rotation ?? 0) * (format === 'DWG' ? 180 / Math.PI : 1);
      } else if (['SOLID', 'TRACE', '3DFACE'].includes(type)) {
        points =
          e.points ??
          e.vertices ??
          (e.corner1 ? [e.corner1, e.corner2, e.corner3, e.corner4] : []);
        if (type !== '3DFACE' && points.length === 4)
          points = [points[0], points[1], points[3], points[2]];
        closed = true;
      } else {
        missing(type);
        continue;
      }
      if (
        !points.length ||
        points.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))
      ) {
        missing(`${type} inválida`);
        continue;
      }
      if (
        points.some(
          (p) => Math.abs((p as Point & { z?: number }).z ?? 0) > 0.001,
        )
      )
        missing('projeção XY de entidade com Z');
      const apply: Transform = (p) =>
        transform(normal.z < 0 && type !== 'LINE' ? { x: -p.x, y: p.y } : p);
      if (textHeight) {
        const base = points[0],
          heightPoint = apply(
            add(base, rotate({ x: 0, y: textHeight }, textRotation ?? 0)),
          ),
          a = apply(base);
        textHeight = Math.hypot(heightPoint.x - a.x, heightPoint.y - a.y);
        const axis = apply(
          add(base, rotate({ x: 1, y: 0 }, textRotation ?? 0)),
        );
        textRotation = (Math.atan2(axis.y - a.y, axis.x - a.x) * 180) / Math.PI;
      }
      primitives.push({
        layer,
        points: points.map(apply),
        closed,
        text,
        textHeight,
        textRotation,
      });
    }
  };
  walk(db.entities ?? [], (p) => p, 0);
  for (const [type, count] of Object.entries(omitted))
    warnings.push(
      `${count} ocorrência(s): ${type} — representação omitida ou simplificada.`,
    );
  if (!primitives.length)
    throw new Error(
      'Nenhuma entidade 2D suportada foi encontrada no espaço de modelo.',
    );
  return {
    id: uid(),
    name,
    format,
    primitives,
    layers: Object.fromEntries(
      [...new Set(primitives.map((p) => p.layer))].map((l) => [l, true]),
    ),
    visible: true,
    opacity: 0.45,
    scale,
    origin: { x: 0, y: 0 },
    rotation: 0,
    sourceUnit,
    warnings,
  };
}
export const maskPoint = (p: Point, m: Mask) =>
  add(m.origin, rotate(mul(p, m.scale), m.rotation));
export function maskPrimitives(m: Mask): Primitive[] {
  return m.visible
    ? m.primitives
        .filter((p) => m.layers[p.layer] !== false)
        .map((p) => ({
          ...p,
          points: p.points.map((v) => maskPoint(v, m)),
          textHeight: (p.textHeight ?? 2.5) * m.scale,
          textRotation: (p.textRotation ?? 0) + m.rotation,
        }))
    : [];
}
