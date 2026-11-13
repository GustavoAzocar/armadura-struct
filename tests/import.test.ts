import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeCad, parseDxf, maskPrimitives } from '../src/cad/import';
const line = {
  type: 'LINE',
  layer: 'FORMAS',
  vertices: [
    { x: 0, y: 0 },
    { x: 100, y: 50 },
  ],
};
describe('máscaras CAD', () => {
  it('lê DXF real do acervo LibreDWG', () => {
    const m = parseDxf(
      readFileSync('tests/fixtures/entities-2d.dxf', 'utf8'),
      'entities-2d.dxf',
    );
    expect(m.primitives.length).toBeGreaterThan(5);
    expect(
      m.primitives.every((p) =>
        p.points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)),
      ),
    ).toBe(true);
  });
  it('converte cm para mm e respeita camadas ocultas', () => {
    const m = normalizeCad(
      { header: { $INSUNITS: 5 }, entities: [line] },
      'cm.dxf',
      'DXF',
    );
    expect(m.scale).toBe(10);
    expect(maskPrimitives(m)[0].points[1]).toEqual({ x: 1000, y: 500 });
    m.layers.FORMAS = false;
    expect(maskPrimitives(m)).toEqual([]);
  });
  it('unidades ausentes e entidades não suportadas geram avisos', () => {
    const m = normalizeCad(
      { entities: [line, { type: 'SPLINE' }] },
      'arquivo.dxf',
      'DXF',
    );
    expect(m.warnings.join()).toMatch(/Unidade não reconhecida/);
    expect(m.warnings.join()).toMatch(/SPLINE/);
  });
  it('expande bloco com ponto base, escala, rotação e herança de camada', () => {
    const m = normalizeCad(
      {
        header: { $INSUNITS: 4 },
        blocks: {
          B: {
            position: { x: 10, y: 20 },
            entities: [
              {
                ...line,
                layer: '0',
                vertices: [
                  { x: 10, y: 20 },
                  { x: 20, y: 20 },
                ],
              },
            ],
          },
        },
        entities: [
          {
            type: 'INSERT',
            name: 'B',
            layer: 'VIGAS',
            position: { x: 100, y: 200 },
            xScale: 2,
            yScale: 2,
            rotation: 90,
          },
        ],
      },
      'bloco.dxf',
      'DXF',
    );
    expect(m.primitives[0].layer).toBe('VIGAS');
    expect(m.primitives[0].points[0]).toEqual({ x: 100, y: 200 });
    expect(m.primitives[0].points[1].x).toBeCloseTo(100);
    expect(m.primitives[0].points[1].y).toBeCloseTo(220);
  });
  it('normaliza blocos do leitor DWG e ângulos em radianos', () => {
    const m = normalizeCad(
      {
        header: { INSUNITS: 4 },
        tables: {
          BLOCK_RECORD: {
            entries: [
              {
                name: 'B',
                basePoint: { x: 0, y: 0 },
                entities: [
                  {
                    type: 'LINE',
                    startPoint: { x: 0, y: 0 },
                    endPoint: { x: 100, y: 0 },
                  },
                ],
              },
            ],
          },
        },
        entities: [
          {
            type: 'INSERT',
            name: 'B',
            insertionPoint: { x: 0, y: 0 },
            rotation: Math.PI / 2,
          },
        ],
      },
      'b.dwg',
      'DWG',
    );
    expect(m.primitives[0].points[1].y).toBeCloseTo(100);
  });
  it('interpreta bulge e arco cruzando zero graus', () => {
    const m = normalizeCad(
      {
        header: { $INSUNITS: 4 },
        entities: [
          {
            type: 'LWPOLYLINE',
            vertices: [
              { x: 0, y: 0, bulge: 1 },
              { x: 100, y: 0 },
            ],
          },
          {
            type: 'ARC',
            center: { x: 0, y: 0 },
            radius: 10,
            startAngle: (3 * Math.PI) / 2,
            endAngle: Math.PI / 2,
          },
        ],
      },
      'arcos.dxf',
      'DXF',
    );
    expect(Math.min(...m.primitives[0].points.map((p) => p.y))).toBeCloseTo(
      -50,
    );
    expect(m.primitives[1].points.some((p) => p.x > 9.9)).toBe(true);
    expect(m.warnings.join()).toContain(
      '2 entidade(s) com curvas aproximadas por segmentos',
    );
  });
  it('omite paper space e planos inclinados com aviso', () => {
    const m = normalizeCad(
      {
        entities: [
          line,
          { ...line, inPaperSpace: true },
          { ...line, extrusionDirection: { x: 1, y: 0, z: 0 } },
        ],
      },
      '3d.dxf',
      'DXF',
    );
    expect(m.primitives).toHaveLength(1);
    expect(m.warnings.join()).toContain('plano 3D');
    expect(m.warnings.join()).toContain(
      '1 ocorrência(s): entidade em espaço de papel',
    );
  });
  it('rejeita arquivos sem geometria ou DXF binário com orientação clara', () => {
    expect(() => normalizeCad({ entities: [] }, 'vazio.dxf', 'DXF')).toThrow(
      /Nenhuma/,
    );
    expect(() => parseDxf('AutoCAD Binary DXF', 'bin.dxf')).toThrow(/ASCII/);
  });
});

it('DWG MTEXT honors vertical direction, attachment and multiline table headings', () => {
  const m = normalizeCad(
    {
      header: { INSUNITS: 4 },
      entities: [
        {
          type: 'MTEXT',
          layer: 'TEXTO',
          insertionPoint: { x: 10, y: 20 },
          direction: { x: 0, y: 1 },
          rotation: 0,
          attachmentPoint: 8,
          textHeight: 2,
          text: '{\\C1;C.UNIT}\\P(cm)',
        },
      ],
    },
    'table.dwg',
    'DWG',
  );
  expect(m.primitives.map((p) => p.text)).toEqual(['C.UNIT', '(cm)']);
  expect(
    m.primitives.every(
      (p) => p.textRotation === 90 && p.textAlign === 'center',
    ),
  ).toBe(true);
  expect(m.primitives[0].points[0].x).toBeCloseTo(7.4);
  expect(m.primitives[1].points[0].x).toBeCloseTo(10);
  expect(m.warnings.join()).toContain(
    '1 entidade(s) de texto com formatação CAD removida',
  );
});
