import type { Point, Project } from '../domain/types';
import {
  angleByPoints,
  MAX_ROTATION_ANGLE,
  type SelectionTransform,
} from '../domain/transforms';
import { NumberField } from './Panels';
export type TransformSession = {
  project: Project;
  ids: string[];
  kind: 'rotate' | 'mirror';
  base?: Point;
  reference?: Point;
  target?: Point;
  cursor?: Point;
  angle: number;
  mode: 'angle' | 'points';
  stage: 'base' | 'reference' | 'target' | 'axis' | 'ready';
  associated: boolean;
};
export function sessionTransform(
  s: TransformSession,
): SelectionTransform | undefined {
  if (!s.base) return;
  if (s.kind === 'mirror') {
    const axisEnd = s.target ?? (s.stage === 'axis' ? s.cursor : undefined);
    return axisEnd ? { kind: 'mirror', base: s.base, axisEnd } : undefined;
  }
  if (s.mode === 'angle')
    return { kind: 'rotate', base: s.base, angle: s.angle };
  const target = s.target ?? (s.stage === 'target' ? s.cursor : undefined);
  return s.reference && target
    ? {
        kind: 'rotate',
        base: s.base,
        angle: angleByPoints(s.base, s.reference, target),
      }
    : undefined;
}
export function RotationAngleField({
  label = 'Ângulo de rotação',
  value,
  onChange,
}: {
  label?: string;
  value?: number;
  onChange: (angle: number) => void;
}) {
  return (
    <NumberField
      label={label}
      value={value}
      min={-MAX_ROTATION_ANGLE}
      max={MAX_ROTATION_ANGLE}
      suffix="°"
      onChange={onChange}
    />
  );
}
export default function TransformPanel({
  value: s,
  onChange,
  onApply,
  onCancel,
  error,
  shared,
}: {
  value: TransformSession;
  onChange: (s: TransformSession) => void;
  onApply: () => void;
  onCancel: () => void;
  error?: string;
  shared: number;
}) {
  const base = s.base ?? { x: 0, y: 0 };
  return (
    <section
      onKeyDown={(e) => {
        if (
          e.key === 'Escape' ||
          ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')
        ) {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
      className="transform-panel"
      aria-label="Transformação da seleção"
    >
      <div className="transform-heading">
        <b>{s.kind === 'rotate' ? 'Rotacionar seleção' : 'Espelhar seleção'}</b>
        <span>{s.ids.length} objeto(s) · prévia</span>
      </div>
      <p>
        {s.stage === 'base'
          ? 'Clique no ponto base comum ou informe suas coordenadas.'
          : s.stage === 'reference'
            ? 'Clique no ponto de referência do ângulo.'
            : s.stage === 'target'
              ? 'Clique na direção final do ângulo.'
              : s.stage === 'axis'
                ? 'Clique no segundo ponto do eixo.'
                : 'Confira a prévia e aplique. Esc ou Desfazer cancela.'}
      </p>
      <div className="fields-2">
        <NumberField
          label="Base X"
          value={base.x}
          onChange={(x) =>
            onChange({
              ...s,
              base: { ...base, x },
              stage:
                s.kind === 'mirror'
                  ? 'axis'
                  : s.mode === 'points'
                    ? 'reference'
                    : 'ready',
            })
          }
          suffix="mm"
        />
        <NumberField
          label="Base Y"
          value={base.y}
          onChange={(y) =>
            onChange({
              ...s,
              base: { ...base, y },
              stage:
                s.kind === 'mirror'
                  ? 'axis'
                  : s.mode === 'points'
                    ? 'reference'
                    : 'ready',
            })
          }
          suffix="mm"
        />
      </div>
      <button
        onClick={() =>
          onChange({
            ...s,
            base: { x: 0, y: 0 },
            stage:
              s.kind === 'mirror'
                ? 'axis'
                : s.mode === 'points'
                  ? 'reference'
                  : 'ready',
          })
        }
      >
        Usar origem (0,0)
      </button>
      <button
        onClick={() =>
          onChange({
            ...s,
            base: undefined,
            reference: undefined,
            target: undefined,
            stage: 'base',
          })
        }
      >
        Escolher base no desenho
      </button>
      {s.kind === 'rotate' ? (
        <>
          <label className="field">
            <span>Definição do ângulo</span>
            <select
              aria-label="Definição do ângulo"
              value={s.mode}
              onChange={(e) =>
                onChange({
                  ...s,
                  mode: e.target.value as 'angle' | 'points',
                  reference: undefined,
                  target: undefined,
                  stage: !s.base
                    ? 'base'
                    : e.target.value === 'points'
                      ? 'reference'
                      : 'ready',
                })
              }
            >
              <option value="angle">Ângulo digitado</option>
              <option value="points">Referência e direção por pontos</option>
            </select>
          </label>
          {s.mode === 'angle' && (
            <RotationAngleField
              value={s.angle}
              onChange={(angle) => onChange({ ...s, angle })}
            />
          )}
        </>
      ) : (
        <div className="fields-2">
          <NumberField
            label="Eixo X"
            value={s.target?.x ?? base.x + 1000}
            onChange={(x) =>
              onChange({
                ...s,
                base,
                target: { x, y: s.target?.y ?? base.y },
                stage: 'ready',
              })
            }
            suffix="mm"
          />
          <NumberField
            label="Eixo Y"
            value={s.target?.y ?? base.y}
            onChange={(y) =>
              onChange({
                ...s,
                base,
                target: { x: s.target?.x ?? base.x + 1000, y },
                stage: 'ready',
              })
            }
            suffix="mm"
          />
        </div>
      )}
      <label>
        <input
          type="checkbox"
          checked={s.associated}
          onChange={(e) => onChange({ ...s, associated: e.target.checked })}
        />
        Incluir chamadas e auxiliares próprios
      </label>
      {shared > 0 && (
        <p>
          {shared} auxiliar(es) compartilhado(s) ou de outro detalhamento ficam
          na posição atual; selecione-os explicitamente para transformar.
        </p>
      )}
      {error && <p role="status">{error}</p>}
      <div className="visibility-actions">
        <button
          className="primary"
          disabled={!s.base || !!error || s.stage !== 'ready'}
          onClick={onApply}
        >
          Aplicar transformação
        </button>
        <button onClick={onCancel}>Cancelar transformação</button>
      </div>
    </section>
  );
}
