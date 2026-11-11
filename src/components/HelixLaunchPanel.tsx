import type { Bar, Point, Project } from '../domain/types';
import type { HelixCriteria } from '../domain/helixSchema';
import { format } from '../domain/geometry';
import { barQuantities } from '../domain/detailQuantities';
import { HelixMemoryTable } from './HelixCriteriaDialog';

export type HelixSession = {
  base: Project;
  key: string;
  detailId: string;
  scope?: string;
  maskId?: string;
  c: HelixCriteria;
  editId?: string;
  id: string;
  mark: string;
  /** Two axis points, or start + direction + declared length. */
  mode: 'points' | 'numeric';
  /** Direction A→B in degrees for the numeric entry. */
  angle: number;
  stage: 'start' | 'end' | 'label' | 'ready';
  start?: Point;
  end?: Point;
  cursor?: Point;
  error?: string;
};

/** Optional label capture returns to the next unfinished step. */
export function helixPlacementStage(
  s: Pick<HelixSession, 'mode' | 'start' | 'end'>,
): HelixSession['stage'] {
  if (!s.start) return 'start';
  if (s.mode === 'points' && !s.end) return 'end';
  return 'ready';
}

export default function HelixLaunchPanel({
  session: s,
  bar,
  error,
  onConfirm,
  onBack,
  onCancel,
  onCriteria,
  onMode,
  onAngle,
  onLabel,
}: {
  session: HelixSession;
  bar?: Bar;
  error?: string;
  onConfirm: () => void;
  onBack: () => void;
  onCancel: () => void;
  onCriteria: () => void;
  onMode: (mode: HelixSession['mode']) => void;
  onAngle: (angle: number) => void;
  onLabel: () => void;
}) {
  const prompts = {
    start:
      'Indique o início A do eixo (centro da seção inicial). Use snaps ou coordenadas.',
    end: 'Indique o fim B do eixo. O trecho bruto é medido em verdadeira grandeza entre A e B.',
    label:
      'Escolha a posição da identificação; a geometria e a quantidade não mudam.',
    ready:
      'Confira a prévia. Enter ou Confirmar lançamento grava a peça completa em uma única operação.',
  };
  const quantity = bar
    ? barQuantities(
        {
          ...s.base,
          hierarchy: {
            ...s.base.hierarchy,
            objectDetails: {
              ...s.base.hierarchy.objectDetails,
              [bar.id]: s.detailId,
            },
          },
        },
        bar,
      )
    : undefined;
  return (
    <section
      className="stirrup-launch-panel helix-launch-panel"
      aria-label="Lançamento de estribo helicoidal"
    >
      <b>Estribo helicoidal · {s.mark}</b>
      <p role="status">{prompts[s.stage]}</p>
      <fieldset className="helix-launch-mode">
        <legend>Entrada do eixo</legend>
        <label>
          <input
            type="radio"
            name="helix-mode"
            checked={s.mode === 'points'}
            onChange={() => onMode('points')}
          />
          Dois pontos A e B
        </label>
        <label>
          <input
            type="radio"
            name="helix-mode"
            checked={s.mode === 'numeric'}
            onChange={() => onMode('numeric')}
          />
          Início, direção e comprimento
        </label>
      </fieldset>
      {s.mode === 'numeric' && (
        <div className="fields-2">
          <label className="field">
            Direção A→B (°)
            <input
              aria-label="Direção A→B (°)"
              type="number"
              step="any"
              value={Number.isNaN(s.angle) ? '' : s.angle}
              onChange={(e) =>
                onAngle(e.target.value === '' ? NaN : Number(e.target.value))
              }
            />
          </label>
          <p className="field-help">
            {s.c.profile.span.source === 'gross' ? 'Hbruto' : 'H útil'} ={' '}
            {format(s.c.profile.span.value, 1)} mm (fonte declarada nos
            critérios).
          </p>
        </div>
      )}
      {bar && quantity && <HelixMemoryTable bar={bar} quantity={quantity} />}
      {(s.error || error) && (
        <p role="alert" className="stirrup-error">
          {s.error || error}
        </p>
      )}
      <div className="beam-clamp-preview-actions">
        <button onClick={onCriteria}>Critérios do helicoidal</button>
        <button disabled={!s.start} onClick={onLabel}>
          Posicionar identificação
        </button>
      </div>
      <div className="dialog-actions">
        <button onClick={onBack}>Voltar etapa</button>
        <button onClick={onCancel}>Cancelar lançamento</button>
        <button
          className="primary"
          disabled={s.stage !== 'ready' || !!error || !!s.error}
          onClick={onConfirm}
        >
          Confirmar lançamento
        </button>
      </div>
    </section>
  );
}
