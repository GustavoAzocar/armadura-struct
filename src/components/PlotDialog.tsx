import { useEffect, useMemo, useRef } from 'react';
import { svgTextFont } from '../domain/textStyle';
import type { Primitive, Project } from '../domain/types';
import { drawingPrimitives } from '../domain/drawingPrimitives';
import { bounds } from '../domain/geometry';
import { primitiveBounds } from '../domain/drafting';
import { dashArray } from '../domain/layers';
import {
  plotPrimitives,
  plotSettings,
  setPlotSettings,
} from '../domain/plotting';
import { NumberField } from './Panels';

function Preview({
  lines,
  scale,
  print,
  box,
}: {
  lines: Primitive[];
  scale: number;
  print: boolean;
  box: ReturnType<typeof bounds>;
}) {
  const margin = 8;
  return (
    <svg
      className="plot-preview"
      aria-label={print ? 'Prévia de impressão' : 'Prévia de tela'}
      viewBox={`${box.x / scale - margin} ${-(box.y + box.height) / scale - margin} ${Math.max(20, box.width / scale) + margin * 2} ${Math.max(20, box.height / scale) + margin * 2}`}
    >
      {lines.slice(0, 5000).map((line, i) => {
        const s = line.resolvedStyle;
        const at = line.points[0];
        if (!at) return null;
        const style = {
          stroke: s?.color ?? '#263044',
          strokeWidth: s?.lineWidth ?? 0.18,
          strokeDasharray:
            dashArray(s, print ? 1 : 1 / scale).join(' ') || undefined,
        };
        return (
          <g
            key={i}
            data-layer-id={line.layerId}
            data-role={line.role ?? line.layer}
          >
            {line.text ? (
              <text
                x={at.x / scale}
                y={-at.y / scale}
                fill={style.stroke}
                fontSize={(line.textHeight ?? 40) / scale}
                {...svgTextFont(line)}
                textAnchor={
                  line.textAlign === 'center'
                    ? 'middle'
                    : line.textAlign === 'right'
                      ? 'end'
                      : 'start'
                }
                transform={`rotate(${-(line.textRotation ?? 0)} ${at.x / scale} ${-at.y / scale})`}
              >
                {line.text.replace(/%%c/g, 'Ø')}
              </text>
            ) : (
              <polyline
                {...style}
                points={[...line.points, ...(line.closed ? [at] : [])]
                  .map((p) => `${p.x / scale},${-p.y / scale}`)
                  .join(' ')}
                fill={line.closed && s?.fill === 'solid' ? s.fillColor : 'none'}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
export default function PlotDialog({
  project,
  onChange,
  onClose,
}: {
  project: Project;
  onChange: (p: Project) => boolean;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => old?.focus();
  }, []);
  const source = useMemo(() => drawingPrimitives(project), [project]);
  const printed = useMemo(
    () => plotPrimitives(project, source),
    [project, source],
  );
  const box = useMemo(() => bounds(source.flatMap(primitiveBounds)), [source]);
  const settings = plotSettings(project);
  return (
    <div className="modal-backdrop">
      <section
        className="modal plot-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plot-title"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
          if (e.key !== 'Tab') return;
          const nodes = [
            ...e.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),select:not(:disabled)',
            ),
          ];
          if (e.shiftKey && document.activeElement === nodes[0]) {
            e.preventDefault();
            nodes.at(-1)?.focus();
          } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
            e.preventDefault();
            nodes[0]?.focus();
          }
        }}
      >
        <button
          ref={close}
          className="modal-close"
          aria-label="Fechar plotagem"
          onClick={onClose}
        >
          ×
        </button>
        <h2 id="plot-title">Estilos de impressão</h2>
        <div className="fields-2">
          <label className="field">
            <span>Preset da saída</span>
            <select
              aria-label="Preset de impressão"
              value={settings.preset}
              onChange={(e) =>
                onChange(
                  setPlotSettings(project, {
                    ...settings,
                    preset: e.target.value as typeof settings.preset,
                  }),
                )
              }
            >
              <option value="color">Colorido</option>
              <option value="monochrome">Monocromático</option>
              <option value="grayscale">Tons de cinza</option>
            </select>
          </label>
          <NumberField
            label="Escala de referência DXF / prévia · 1:"
            value={settings.referenceScale}
            min={1}
            max={10000}
            onChange={(referenceScale) =>
              onChange(
                setPlotSettings(project, { ...settings, referenceScale }),
              )
            }
          />
        </div>
        <p>
          Configure os estilos de impressão em Gerenciar layers ou nas
          propriedades do objeto. Os presets preservam as penas; branco
          explícito permanece branco.
        </p>
        <div className="plot-comparison">
          <figure>
            <figcaption>Tela · cores do CAD</figcaption>
            <Preview
              lines={source}
              scale={settings.referenceScale}
              print={false}
              box={box}
            />
          </figure>
          <figure>
            <figcaption>Impressão · {printed.length} entidades</figcaption>
            <Preview
              lines={printed}
              scale={settings.referenceScale}
              print
              box={box}
            />
          </figure>
        </div>
        <p className="field-help">
          Modelo completo, ajustado à janela; esta prévia compara estilos. A aba
          da folha mostra a composição e as escalas finais do PDF. O DXF mantém
          coordenadas em mm no modelo; use a escala de referência ao plotá-lo.
        </p>
        {source.length > 5000 && (
          <p>
            Prévia limitada às primeiras 5.000 entidades por painel. A
            exportação inclui todas as entidades imprimíveis.
          </p>
        )}
        <button onClick={onClose}>Concluir</button>
      </section>
    </div>
  );
}
