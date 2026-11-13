import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { prepareCadPreview } from '../src/lib/cadPreview';
import CadPreview from '../src/components/CadPreview';
import { defaultLayers } from '../src/domain/layers';
import type { Primitive } from '../src/domain/types';

it('a dense mask preview retains every exact segment in one SVG path', () => {
  const lines: Primitive[] = Array.from({ length: 20000 }, (_, i) => ({
    layer: 'FORMA',
    points: [
      { x: i + 0.123456789, y: i },
      { x: i + 1, y: i + 2 },
    ],
  }));
  const before = JSON.stringify(lines);
  const prepared = prepareCadPreview(lines);
  expect(prepared).toHaveLength(1);
  if (prepared[0].kind !== 'path') throw Error();
  expect(prepared[0].d.match(/M/g)).toHaveLength(20000);
  expect(prepared[0].d).toContain('M0.123456789,0 L1,2');
  expect(prepared[0].d).toContain('M19999.123456789,19999 L20000,20001');
  const svg = renderToStaticMarkup(
    createElement('svg', null, createElement(CadPreview, { lines, stroke: 2 })),
  );
  expect(svg.match(/<path /g)).toHaveLength(1);
  expect(JSON.stringify(lines)).toBe(before);
});
it('preserves closure, text order/rotation/font and style boundaries', () => {
  const style = defaultLayers()[0];
  const lines: Primitive[] = [
    {
      layer: 'FORMA',
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
      closed: true,
    },
    {
      layer: 'COTAS',
      text: 'Ø 12 · ação',
      textRotation: 37,
      textHeight: 55,
      points: [{ x: 5, y: 6 }],
    },
    {
      layer: 'FORMA',
      points: [
        { x: 7, y: 8 },
        { x: 9, y: 10 },
      ],
      resolvedStyle: { ...style, lineWidth: 0.7 },
    },
    {
      layer: 'FORMA',
      points: [
        { x: 11, y: 12 },
        { x: 13, y: 14 },
      ],
      resolvedStyle: { ...style, lineType: { name: 'DASH', pattern: [3, 2] } },
    },
  ];
  const prepared = prepareCadPreview(lines);
  expect(prepared.map((p) => p.kind)).toEqual(['path', 'text', 'path', 'path']);
  expect(prepared[0]).toMatchObject({ d: 'M1,2 L3,4 Z' });
  const svg = renderToStaticMarkup(
    createElement('svg', null, createElement(CadPreview, { lines, stroke: 1 })),
  );
  expect(svg).toContain('rotate(37)');
  expect(svg).toContain('font-size="55"');
  expect(svg).toContain('text-anchor="middle"');
  expect(svg).toContain('stroke-dasharray="3 2"');
  expect(svg.indexOf('Ø 12')).toBeLessThan(svg.indexOf('M7,8'));
});
