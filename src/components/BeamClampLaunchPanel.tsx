import type { Bar, Point, Project } from '../domain/types';
import type { BeamClampCriteria } from '../domain/beamClampSchema';
import { format, geometry } from '../domain/geometry';
import { barQuantities } from '../domain/detailQuantities';
import { distributionStep } from '../domain/drafting';

export type BeamClampSession = {
  base: Project;
  key: string;
  detailId: string;
  scope?: string;
  maskId?: string;
  c: BeamClampCriteria;
  editId?: string;
  id: string;
  mark: string;
  stage:
    | 'insertion'
    | 'direction'
    | 'range-start'
    | 'range-end'
    | 'label'
    | 'ready';
  insertion?: Point;
  start?: Point;
  end?: Point;
  label?: Point;
  cursor?: Point;
  error?: string;
};

/** Optional direction/label captures must return to the next unfinished step. */
export function beamClampPlacementStage(
  s: Pick<BeamClampSession, 'c' | 'insertion' | 'start' | 'end'>,
): BeamClampSession['stage'] {
  if (!s.insertion) return 'insertion';
  if (!s.c.distribute) return 'ready';
  if (!s.start) return 'range-start';
  return s.end ? 'ready' : 'range-end';
}

export default function BeamClampLaunchPanel({
  session: s,
  bar,
  error,
  onConfirm,
  onBack,
  onCancel,
  onCriteria,
  onDirection,
  onFlip,
  onLabel,
}: {
  session: BeamClampSession;
  bar?: Bar;
  error?: string;
  onConfirm: () => void;
  onBack: () => void;
  onCancel: () => void;
  onCriteria: () => void;
  onDirection?: () => void;
  onFlip?: () => void;
  onLabel?: () => void;
}) {
  const prompts = {
    insertion:
      'Posicione o meio do trecho transversal fechado. Um ponto basta com o ângulo definido.',
    direction:
      'Indique o segundo ponto da direção da viga. L e T permanecem inalterados.',
    'range-start':
      'Indique o início da faixa de distribuição, independente do eixo da peça.',
    'range-end': 'Indique o fim da faixa de distribuição.',
    label:
      'Escolha a posição da identificação; a geometria e a quantidade permanecem iguais.',
    ready:
      'Confira a prévia. Enter ou Confirmar lançamento grava a operação completa.',
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
      className="stirrup-launch-panel beam-clamp-launch-panel"
      aria-label="Lançamento de grampo de viga"
    >
      <b>Grampo de viga · {s.mark}</b>
      <p role="status">{prompts[s.stage]}</p>
      <p>
        L = {format(s.c.profile.longitudinal, 2)} mm · T ={' '}
        {format(s.c.profile.transverse, 2)} mm · {format(s.c.rotation, 2)}° ·
        dobra à {s.c.view.closedSide === 'left' ? 'esquerda' : 'direita'}
      </p>
      {bar && (
        <p>
          Comprimento unitário de corte: {format(geometry(bar).length, 3)} mm ·{' '}
          {bar.quantity} grampos × {bar.multiplier} × {quantity!.repetitions}{' '}
          repetições = <b>{quantity!.quantity} grampos completos</b>
          {bar.distribution
            ? ` · passo efetivo ${format(distributionStep(bar), 2)} mm`
            : ''}
        </p>
      )}
      {(s.error || error) && (
        <p role="alert" className="stirrup-error">
          {s.error || error}
        </p>
      )}
      <div className="beam-clamp-preview-actions">
        <button onClick={onCriteria}>Critérios do grampo de viga</button>
        {onDirection && (
          <button disabled={!s.insertion} onClick={onDirection}>
            Definir direção por segundo ponto
          </button>
        )}
        {onFlip && (
          <button onClick={onFlip}>Alternar dobra esquerda/direita</button>
        )}
        {onLabel && (
          <button disabled={!s.insertion} onClick={onLabel}>
            Reposicionar identificação
          </button>
        )}
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
