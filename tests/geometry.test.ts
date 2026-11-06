import { describe, it, expect } from 'vitest';
import {
  bounds,
  geometry,
  offsetChain,
  rotate,
  sampled,
  world,
} from '../src/domain/geometry';
import {
  newBar,
  demoProject,
  decodeProject,
  emptyProject,
  schedule,
} from '../src/domain/model';
import { toCsv, toDxf, assertExportable } from '../src/lib/exports';
import { parseDxf } from '../src/cad/import';
const point = (x: number, y: number) => ({ x, y });
describe('comprimentos físicos pelo eixo', () => {
  it('barra reta de 1m e peso de Ø10 com densidade 7850', () => {
    const b = { ...newBar('N1'), diameter: 10, quantity: 3 };
    const p = { ...emptyProject(), bars: [b] };
    expect(geometry(b).length).toBe(1000);
    const row = schedule(p)[0];
    expect(row.totalLength).toBe(3);
    expect(row.weight).toBeCloseTo(((3 * Math.PI * 0.01 ** 2) / 4) * 7850, 10);
  });
  it('dobra de 90 graus: retas menos duas tangências mais arco', () => {
    const b = {
      ...newBar('N1'),
      diameter: 10,
      mandrel: 50,
      points: [point(0, 0), point(1000, 0), point(1000, 500)],
    };
    const g = geometry(b);
    expect(g.errors).toEqual([]);
    expect(g.length).toBeCloseTo(1500 - 60 + (30 * Math.PI) / 2, 10);
    const arc = g.segments[1];
    expect(arc.type).toBe('arc');
    expect(arc.a).toEqual(point(970, 0));
    expect(arc.b.x).toBeCloseTo(1000);
    expect(arc.b.y).toBeCloseTo(30);
    expect(sampled(g.segments).at(-1)).toEqual(point(1000, 500));
  });
  it('espelhamento, rotação e translação preservam comprimento', () => {
    const b = demoProject().bars[0];
    const len = geometry(b).length;
    expect(
      geometry({ ...b, origin: point(-300, 500), rotation: 43 }).length,
    ).toBe(len);
    expect(
      geometry({ ...b, points: b.points.map((p) => point(-p.x, p.y)) }).length,
    ).toBeCloseTo(len, 10);
    expect(
      world(point(100, 0), { origin: point(10, 20), rotation: 90 }),
    ).toEqual(point(10.000000000000005, 120));
    expect(rotate(point(100, 0), 90).y).toBeCloseTo(100);
  });
  it('estribo com dois ganchos de 135 graus e três cantos de 90 graus', () => {
    const b = {
      ...newBar('N1'),
      kind: 'stirrup' as const,
      width: 250,
      height: 500,
      diameter: 10,
      mandrel: 50,
      hook: 100,
    };
    const r = 30;
    const expected =
      2 * (250 + 500) +
      2 * 100 -
      2 * r * Math.tan((3 * Math.PI) / 8) -
      6 * r +
      3 * Math.PI * r;
    const g = geometry(b);
    expect(g.errors).toEqual([]);
    expect(g.length).toBeCloseTo(expected, 10);
    expect(g.segments.filter((s) => s.type === 'arc')).toHaveLength(5);
  });
  it('rejeita trecho insuficiente em vez de reduzir o mandril', () => {
    const b = {
      ...newBar('N1'),
      diameter: 10,
      mandrel: 50,
      points: [point(0, 0), point(10, 0), point(10, 100)],
    };
    expect(geometry(b).errors.join()).toMatch(/insuficiente/);
    expect(() => assertExportable({ ...emptyProject(), bars: [b] })).toThrow(
      /N1/,
    );
  });
  it('retorno de 180 graus e pontos repetidos são sinalizados', () => {
    let b = {
      ...newBar('N1'),
      points: [point(0, 0), point(100, 0), point(0, 0)],
    };
    expect(geometry(b).errors.join()).toMatch(/180/);
    b = { ...b, points: [point(0, 0), point(0, 0), point(100, 0)] };
    expect(geometry(b).errors.join()).toMatch(/nulo/);
  });
  it('detalhes e distribuição não multiplicam a quantidade duas vezes', () => {
    const p = demoProject();
    const weights = schedule(p).map((r) => r.weight);
    p.details.push({ ...p.details[0], id: 'extra' });
    p.bars[0].distribution = { end: point(5000, 0) };
    expect(schedule(p).map((r) => r.weight)).toEqual(weights);
  });
});
describe('contornos de fôrma e estabilidade', () => {
  const square = [point(0, 0), point(1000, 0), point(1000, 500), point(0, 500)];
  it('offset de cobrimento mais meio diâmetro para o interior em ambos os sentidos', () => {
    const a = offsetChain(square, 35, true);
    expect(a).toEqual([
      point(35, 35),
      point(965, 35),
      point(965, 465),
      point(35, 465),
      point(35, 35),
    ]);
    expect(bounds(offsetChain([...square].reverse(), 35, true))).toEqual(
      bounds(a),
    );
  });
  it('offset de linha aberta para a esquerda', () => {
    expect(offsetChain([point(0, 0), point(1000, 0)], 34, false)).toEqual([
      point(0, 34),
      point(1000, 34),
    ]);
  });
  it('rejeita contorno vazio ou cobrimento que colapsa a seção', () => {
    expect(() => offsetChain([], 10, true)).toThrow();
    expect(() => offsetChain(square, 300, true)).toThrow(/excessivo/);
  });
  it('enquadra 200 mil pontos sem estouro da pilha', () => {
    expect(
      bounds(Array.from({ length: 200000 }, (_, i) => point(i, -i))),
    ).toEqual({ x: 0, y: -199999, width: 199999, height: 199999 });
  });
});
describe('arquivo do projeto e exportações', () => {
  it('salva e reabre todos os dados de demonstração', () => {
    const p = demoProject();
    expect(decodeProject(JSON.stringify(p))).toEqual(p);
  });
  it('rejeita posição duplicada, vínculo órfão e números inválidos', () => {
    const p = demoProject();
    p.bars[1].mark = p.bars[0].mark;
    expect(() => decodeProject(JSON.stringify(p))).toThrow(/identificação/);
    const q = demoProject();
    q.details[0].barId = 'ausente';
    expect(() => decodeProject(JSON.stringify(q))).toThrow(/correspondente/);
    q.details = [];
    q.bars[0].diameter = -1;
    expect(() => decodeProject(JSON.stringify(q))).toThrow();
  });
  it('DXF exportado reabre com geometria, identificação e quadro', () => {
    const p = demoProject();
    const dxf = toDxf(p);
    const m = parseDxf(dxf, 'saida.dxf');
    expect(m.scale).toBe(1);
    expect(m.layers.ARMADURAS).toBe(true);
    expect(m.layers.REBATIMENTOS).toBe(true);
    expect(m.primitives.some((x) => x.text?.includes('QUADRO DE ACO'))).toBe(
      true,
    );
    expect(m.warnings).toEqual([]);
  });
  it('CSV usa quantidade física e impede fórmula em identificação textual', () => {
    const p = demoProject();
    p.bars[0].element = '=1+1';
    const csv = toCsv(p);
    expect(csv).toContain('"\'=1+1"');
    expect(csv.split('\r\n')).toHaveLength(4);
    expect(csv).toContain('"3"');
  });
});
