import colors from 'dxf-parser/dist/AutoCadColorIndex.js';
import type { DrawingLayer, DrawingStyle } from '../domain/types';
import { defaultLayers } from '../domain/layers';
// The geometry reader omits some LAYER tags. Read only supported table metadata here.
export function dxfStyleTables(text: string) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/),
    layers: Record<string, Record<string, unknown>> = {},
    types: Record<string, Record<string, unknown>> = {};
  const hatches: Record<string, unknown>[] = [],
    warnings: string[] = [];
  const trueColors: Record<string, number> = {};
  let section = '';
  let table = '',
    record: [number, string][] = [];
  const flush = () => {
    if (!record.length) return;
    const type = record[0][1],
      get = (code: number) => record.find((p) => p[0] === code)?.[1],
      name = get(2);
    if (get(5) && get(420) !== undefined)
      trueColors[get(5)!] = Number(get(420));
    if (type === 'HATCH' && section === 'ENTITIES' && get(67) !== '1') {
      const start = record.findIndex((p) => p[0] === 93),
        count = Number(get(93)),
        verts: { x: number; y: number }[] = [];
      if (
        name === 'SOLID' &&
        get(91) === '1' &&
        Number(get(92)) & 2 &&
        get(72) === '0' &&
        start >= 0
      ) {
        for (
          let i = start + 1;
          i < record.length && verts.length < count;
          i++
        ) {
          if (record[i][0] === 10 && record[i + 1]?.[0] === 20)
            verts.push({ x: Number(record[i][1]), y: Number(record[++i][1]) });
        }
        if (verts.length === count)
          hatches.push({
            type: 'SOLID-POLYGON',
            layer: get(8) ?? '0',
            vertices: verts,
            colorIndex: get(62) === undefined ? undefined : Number(get(62)),
            trueColor: get(420) === undefined ? undefined : Number(get(420)),
            lineType: get(6),
            lineTypeScale: get(48) === undefined ? undefined : Number(get(48)),
            lineweight: get(370) === undefined ? undefined : Number(get(370)),
          });
      } else
        warnings.push(
          'HATCH complexo, com furos ou padrão: preenchimento não interpretado.',
        );
    }
    if (!name) return;
    if (type === 'LAYER' && table === 'LAYER')
      layers[name] = {
        name,
        colorIndex: Number(get(62) ?? 7),
        trueColor: get(420) === undefined ? undefined : Number(get(420)),
        lineType: get(6) ?? 'CONTINUOUS',
        lineweight: Number(get(370) ?? -3),
        flags: Number(get(70) ?? 0),
      };
    if (type === 'LTYPE' && table === 'LTYPE')
      types[name] = {
        name,
        pattern: record.filter((p) => p[0] === 49).map((p) => Number(p[1])),
        complex: record.some((p) => p[0] === 74 && Number(p[1]) !== 0),
      };
  };
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim()),
      value = lines[i + 1].trim();
    if (code === 0) {
      flush();
      record = [[code, value]];
      if (value === 'ENDTAB') table = '';
    } else {
      record.push([code, value]);
      if (record[0]?.[1] === 'TABLE' && code === 2) table = value;
      if (record[0]?.[1] === 'SECTION' && code === 2) section = value;
    }
  }
  flush();
  return {
    layers,
    types,
    hatches,
    warnings: [...new Set(warnings)],
    trueColors,
  };
}
export function cadColor(value: unknown, index?: unknown): string | undefined {
  const v =
    typeof value === 'object' && value !== null
      ? (value as { rgb?: number; index?: number })
      : undefined;
  const n =
    v?.rgb ??
    (typeof value === 'number' ? value : undefined) ??
    colors[Math.abs(Number(v?.index ?? index))];
  return Number.isFinite(n) && n! >= 0 && n! <= 0xffffff
    ? `#${n!.toString(16).padStart(6, '0')}`
    : undefined;
}
export function cadLineType(
  name: string,
  types: Record<string, any>,
  scale: number,
  warnings: string[],
) {
  const safeName =
    name
      .trim()
      .replace(/[<>/\\":;?*|=\x00-\x1f]/g, '_')
      .slice(0, 100) || 'CONTINUOUS';
  if (safeName !== name)
    warnings.push(`Tipo de linha ${name}: nome normalizado para ${safeName}.`);
  const raw = types[name],
    pattern = (raw?.pattern ?? raw?.dashes)?.map((d: any) =>
      typeof d === 'number' ? d : (d.elementLength ?? d.length),
    ),
    complex =
      raw?.complex ||
      raw?.pattern?.some(
        (d: any) => d.elementTypeFlag && d.elementTypeFlag !== 1,
      );
  if (name.toUpperCase() === 'CONTINUOUS')
    return { name: safeName, pattern: [] };
  if (
    !complex &&
    Array.isArray(pattern) &&
    pattern.length <= 64 &&
    pattern.every(Number.isFinite) &&
    pattern.length % 2 === 0 &&
    pattern.every((n, i) => (i % 2 === 0 ? n >= 0 : n < 0)) &&
    pattern.some((n) => n !== 0) &&
    pattern.every((n) => Math.abs(n * scale) <= 1e6)
  )
    return { name: safeName, pattern: pattern.map((n) => n * scale) };
  const message = `Tipo de linha ${name}: padrão complexo ou ausente; exibido/exportado como contínuo.`;
  if (!warnings.includes(message)) warnings.push(message);
  return { name: 'CONTINUOUS', pattern: [] };
}
export function cadLayers(
  db: Record<string, any>,
  maskId: string,
  unit: number,
  warnings: string[],
): DrawingLayer[] {
  const rows =
    db.styleTables?.layers ??
    db.tables?.layer?.layers ??
    Object.fromEntries(
      (db.tables?.LAYER?.entries ?? []).map((l: any) => [l.name, l]),
    );
  const types =
    db.styleTables?.types ??
    db.tables?.lineType?.lineTypes ??
    Object.fromEntries(
      (db.tables?.LTYPE?.entries ?? []).map((l: any) => [l.name, l]),
    );
  return Object.entries(rows as Record<string, any>).map(([name, r], i) => ({
    ...defaultLayers()[8],
    id: `${maskId}:layer:${i}`,
    name,
    color: cadColor(r.trueColor ?? r.color, r.colorIndex) ?? '#8992a4',
    fillColor: cadColor(r.trueColor ?? r.color, r.colorIndex) ?? '#8992a4',
    lineType: cadLineType(
      r.lineType ?? r.linetype ?? 'CONTINUOUS',
      types,
      unit,
      warnings,
    ),
    lineWidth:
      typeof r.lineweight === 'number' && r.lineweight >= 0
        ? Math.min(2.11, r.lineweight / 100)
        : 0.18,
  }));
}
export function cadOverrides(
  e: Record<string, any>,
  types: Record<string, any>,
  unit: number,
  warnings: string[],
): Partial<DrawingStyle> {
  const style: Partial<DrawingStyle> = {};
  if (
    (e.colorIndex !== undefined &&
      ![0, 256].includes(Math.abs(e.colorIndex))) ||
    (e.color !== undefined && e.colorIndex === undefined)
  ) {
    const c = cadColor(e.color, e.colorIndex);
    if (c) style.color = c;
  }
  // A true colour tag wins over an ACI tag, including BYLAYER.
  if (
    e.color !== undefined &&
    [0, 256].includes(e.colorIndex) &&
    e.color !== colors[e.colorIndex]
  ) {
    const c = cadColor(e.color);
    if (c) style.color = c;
  }
  if (e.trueColor !== undefined) {
    const c = cadColor(e.trueColor);
    if (c) style.color = c;
  }
  const name = e.lineType ?? e.linetype;
  if (name && !['BYLAYER', 'BYBLOCK'].includes(name.toUpperCase()))
    style.lineType = cadLineType(name, types, unit, warnings);
  if (Number.isFinite(e.lineTypeScale) && e.lineTypeScale > 0)
    style.lineScale = Math.min(10000, e.lineTypeScale);
  if (Number.isFinite(e.lineweight) && e.lineweight >= 0)
    style.lineWidth = Math.min(2.11, e.lineweight / 100);
  return style;
}
