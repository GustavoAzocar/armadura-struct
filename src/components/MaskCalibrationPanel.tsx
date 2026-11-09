import { useEffect, useRef } from 'react';
import type { Point, Project, Mask } from '../domain/types';
import type { MaskDrawingContext } from '../domain/maskDrawing';
import { detailPath } from '../domain/hierarchy';
import { format } from '../domain/geometry';
export type MaskCalibrationSession = {
  project: Project;
  mask: Mask;
  context: MaskDrawingContext;
  activeAtStart: string;
  points: Point[];
  input: string;
  issue?: string;
};
export type MaskCalibrationPreview = {
  current?: number;
  factor?: number;
  desired?: number;
  endpoint?: Point;
  error?: string;
};
export default function MaskCalibrationPanel({
  value: s,
  onInput,
  onApply,
  onCancel,
  onRepick,
  preview,
}: {
  value: MaskCalibrationSession;
  onInput: (raw: string) => void;
  onApply: () => void;
  onCancel: () => void;
  onRepick: () => void;
  preview: MaskCalibrationPreview;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (s.points.length !== 2) return;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [s.points.length]);
  return (
    <section
      className="mask-calibration-panel"
      aria-label="Ajustar escala da máscara"
      onKeyDown={(e) => {
        if (
          e.key === 'Escape' ||
          ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')
        ) {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        } else if (
          (e.ctrlKey || e.metaKey) &&
          ['s', 'o', 'y'].includes(e.key.toLowerCase())
        ) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div className="transform-heading">
        <b>Ajustar escala</b>
        <span>
          {s.points.length < 2 ? `Etapa ${s.points.length + 1}/3` : 'Etapa 3/3'}
        </span>
      </div>
      <p>
        <strong>{s.mask.name}</strong> · {s.mask.format} ·{' '}
        {detailPath(s.project, s.context.detailId)} · [{s.mask.id.slice(0, 8)}]
      </p>
      <p>
        {s.points.length === 0
          ? 'Escolha P1, o ponto que ficará fixo, por clique ou coordenadas.'
          : s.points.length === 1
            ? 'Escolha P2 para medir a distância atual. Encaixes e Ortogonal disponíveis.'
            : 'Informe a distância real entre P1 e P2. Enter aplica imediatamente, em uma operação.'}
      </p>
      <p>
        P1 fica fixo. Escala da máscara no modelo; zoom e escala da prancha
        permanecem independentes.
      </p>
      {s.mask.primitives.some(
        (p) => p.native?.kind === 'circle' || p.native?.kind === 'arc',
      ) && (
        <p className="field-help">
          Círculos/arcos permanecem analíticos no projeto. A saída atual usa
          polilinhas: erro de corda de até{' '}
          {format(0.05 * s.mask.scale * (preview.factor ?? 1), 6)} mm do modelo.
        </p>
      )}
      {s.mask.format !== 'NATIVE' && (
        <p className="field-help">
          A referência normalizada e seus avisos são preservados. Curvas
          importadas já amostradas mantêm sua aproximação.
        </p>
      )}
      {s.points.map((p, i) => (
        <p key={i}>
          P{i + 1}: ({format(p.x, 6)}; {format(p.y, 6)}) mm
        </p>
      ))}
      {preview.current !== undefined && (
        <p>
          Distância atual:{' '}
          <output data-testid="calibration-current">
            {format(preview.current, 6)} mm
          </output>
        </p>
      )}
      {s.points.length === 2 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onApply();
          }}
        >
          <label className="field">
            Distância real (mm; aceita cm/m)
            <input
              ref={input}
              aria-label="Distância real da máscara"
              inputMode="decimal"
              type="text"
              placeholder="2000 mm ou 2,5 m"
              value={s.input}
              onChange={(e) => onInput(e.target.value)}
            />
          </label>
          {preview.factor !== undefined && (
            <p data-testid="calibration-result">
              Fator ×{format(preview.factor, 9)} · {format(preview.desired!, 6)}{' '}
              mm. P2 resultante: ({format(preview.endpoint!.x, 6)};{' '}
              {format(preview.endpoint!.y, 6)}) mm.
            </p>
          )}
          <p className="field-help">
            Sem separador de milhar. Valor sem sufixo = mm. A unidade declarada
            do CAD é preservada.
          </p>
          <button type="submit" className="primary">
            Aplicar distância
          </button>
          <button type="button" onClick={onRepick}>
            Escolher novamente P1/P2
          </button>
        </form>
      )}
      {(s.issue || preview.error) && (
        <p role="alert">{s.issue || preview.error}</p>
      )}
      <button onClick={onCancel}>Cancelar ajuste de escala</button>
    </section>
  );
}
