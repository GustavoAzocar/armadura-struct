import { useState } from 'react';
import { barDevelopment, type BarDevelopment } from '../domain/barDevelopment';
import { barDimensions, type BarDimension } from '../domain/barDimensions';
import {
  formatDimension,
  type DimensionPresentation,
} from '../domain/dimensionPresentation';
import { bounds, format, path, sampled } from '../domain/geometry';
import type { Bar, Segment } from '../domain/types';
import { HelixDiagram } from './HelixCriteriaDialog';
import './BarCutMemory.css';

type DimensionUnit = DimensionPresentation['unit'];
type Development = Extract<BarDevelopment, { status: 'available' }>;

const precision = { mm: 3, cm: 4, m: 6 };

const roles = {
  body: '',
  'start-hook': ' · gancho inicial',
  'end-hook': ' · gancho final',
} as const;

const parcelNames = {
  straight: 'Reta efetiva',
  arc: 'Arco',
  helix: 'Hélice',
} as const;

function PlanarDiagram({
  development,
  external,
}: {
  development: Development;
  external: BarDimension[];
}) {
  const segments = development.parcels.flatMap((p): Segment[] => {
    if (p.kind === 'helix') return [];
    if (p.kind === 'straight') return [{ type: 'line', a: p.a, b: p.b }];
    return [
      {
        type: 'arc',
        a: p.a,
        b: p.b,
        center: p.center,
        radius: p.radius,
        angle: p.angle,
        startAngle: p.startAngle,
      },
    ];
  });
  const theory = development.polyline?.legs ?? [];
  const theoreticalPoints = theory.length
    ? [theory[0].from, ...theory.map((leg) => leg.to)]
    : [];
  const witnesses = external.flatMap((d) => [d.from.point, d.to.point]);
  const { x, y, width, height } = bounds([
    ...sampled(segments),
    ...theoreticalPoints,
    ...witnesses,
  ]);
  const margin = Math.max(width, height, 1) * 0.12;

  return (
    <figure>
      <svg
        role="img"
        aria-label="Esquema do eixo físico da armadura"
        viewBox={`${x - margin} ${-y - height - margin} ${width + 2 * margin} ${height + 2 * margin}`}
      >
        <g transform="scale(1 -1)" fill="none" stroke="currentColor">
          {theoreticalPoints.length > 0 && (
            <polyline
              points={theoreticalPoints
                .map(({ x, y }) => `${x},${y}`)
                .join(' ')}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path
            d={path(segments)}
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />
          {witnesses.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={margin * 0.15}
              fill="var(--accent)"
              stroke="none"
            />
          ))}
        </g>
      </svg>
      <figcaption>
        Eixo físico
        {theoreticalPoints.length > 0 && ' · poligonal teórica tracejada'}
        {witnesses.length > 0 && ' · pontos das cotas externas'}
      </figcaption>
    </figure>
  );
}

function MemoryContent({ bar, unit }: { bar: Bar; unit: DimensionUnit }) {
  const development = barDevelopment(bar);
  if (development.status === 'invalid')
    return <p role="status">{development.diagnostics.join(' ')}</p>;

  const dimensions = barDimensions(bar);
  const value = (mm: number) =>
    formatDimension(mm, { unit, precision: precision[unit] });
  const sum = (filter: (p: Development['parcels'][number]) => boolean) =>
    development.parcels
      .filter(filter)
      .reduce((total, p) => total + p.length, 0);
  const theory = development.polyline;

  return (
    <div className="bar-cut-memory-content">
      {bar.kind === 'helix' ? (
        <HelixDiagram bar={bar} />
      ) : (
        <PlanarDiagram
          development={development}
          external={dimensions.external}
        />
      )}
      <dl>
        <dt>Bitola</dt>
        <dd>{format(development.diameter, 2)} mm</dd>
        {bar.kind !== 'helix' && (
          <>
            <dt>Mandril interno</dt>
            <dd>{format(development.mandrel, 2)} mm</dd>
          </>
        )}
        {dimensions.axis.length > 0 && (
          <>
            <dt>
              {dimensions.axis[0].from.kind === 'axis-envelope'
                ? 'Pelo eixo do corpo'
                : 'Entre vértices teóricos'}
            </dt>
            <dd>{dimensions.axis.map((d) => value(d.length)).join(' · ')}</dd>
          </>
        )}
        {dimensions.external.length > 0 && (
          <>
            <dt>Cotas externas</dt>
            <dd>
              {dimensions.external.map((d) => value(d.length)).join(' · ')}
            </dd>
          </>
        )}
      </dl>
      {dimensions.diagnostic && <p>{dimensions.diagnostic}</p>}
      <div
        className="bar-cut-memory-rows"
        tabIndex={0}
        role="region"
        aria-label="Parcelas do eixo físico"
      >
        <table aria-label="Parcelas do eixo físico">
          <tbody>
            {development.parcels.map((p, i) => (
              <tr key={i}>
                <th scope="row">
                  {i + 1}. {parcelNames[p.kind]}
                  {roles[p.role]}
                  {p.kind === 'arc' && (
                    <small>
                      {format((Math.abs(p.angle) * 180) / Math.PI, 2)}°{' · '}R
                      no eixo {value(p.radius)}
                    </small>
                  )}
                  {p.kind === 'helix' && (
                    <small>
                      R no eixo {value(p.axisRadius)} · H útil {value(p.height)}
                      {' · '}passo {value(p.pitch)} · {format(p.turns, 3)}{' '}
                      voltas
                    </small>
                  )}
                </th>
                <td>{value(p.length)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {theory && (
        <>
          <p>
            {value(theory.theoreticalLength)} no eixo teórico −{' '}
            {value(theory.setbackLength)} de recuos +{' '}
            {value(
              sum(
                (p) =>
                  p.kind === 'arc' &&
                  (!theory.hooksOutsidePolyline || p.role === 'body'),
              ),
            )}{' '}
            em arcos
            {theory.hooksOutsidePolyline &&
              ` + ${value(sum((p) => p.role !== 'body'))} em ganchos`}
            .
          </p>
          <details>
            <summary>Vértices teóricos e recuos</summary>
            <div
              className="bar-cut-memory-rows"
              tabIndex={0}
              role="region"
              aria-label="Trechos teóricos e recuos"
            >
              <table aria-label="Trechos teóricos e recuos">
                <tbody>
                  {theory.legs.map((leg, i) => (
                    <tr key={i}>
                      <th scope="row">
                        Trecho {i + 1}
                        <small>
                          ({format(leg.from.x, 3)}, {format(leg.from.y, 3)}) → (
                          {format(leg.to.x, 3)}, {format(leg.to.y, 3)}) mm
                        </small>
                        <small>
                          Recuos {value(leg.startSetback)} /{' '}
                          {value(leg.endSetback)}
                        </small>
                      </th>
                      <td>{value(leg.theoreticalLength)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      <dl className="bar-cut-memory-totals">
        <dt>Desenvolvimento geométrico</dt>
        <dd>{value(development.geometricLength)}</dd>
        <dt>Comprimento de corte</dt>
        <dd>{value(development.cutLength)}</dd>
      </dl>
      <p>
        Na política atual, o corte é igual ao desenvolvimento geométrico. Os
        totais usam os valores antes da formatação.
      </p>
    </div>
  );
}

export function BarCutMemory({
  bar,
  dimensionUnit = 'mm',
}: {
  bar: Bar;
  dimensionUnit?: DimensionUnit;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="bar-cut-memory"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Memória de corte</summary>
      {open && <MemoryContent bar={bar} unit={dimensionUnit} />}
    </details>
  );
}
