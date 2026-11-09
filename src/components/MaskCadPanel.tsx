import { useState } from 'react';
import type { Point, Project } from '../domain/types';
import type { MaskDrawingContext } from '../domain/maskDrawing';
import { detailPath } from '../domain/hierarchy';
import { format } from '../domain/geometry';
import type {
  MaskCadEntity,
  MaskCadMode,
  MaskEntityRef,
  MaskCadPlan,
} from '../domain/maskCadEditing';
export type MaskCadSession = {
  project: Project;
  maskId: string;
  activeAtStart: string;
  context: MaskDrawingContext;
  mode: MaskCadMode;
  stage: 'limits' | 'targets';
  limits: MaskEntityRef[];
  all: boolean;
  hadOperations: boolean;
  hover?: { ref: MaskEntityRef; at: Point };
  selectedTarget?: string;
  issue?: string;
};
export default function MaskCadPanel({
  session: s,
  entities,
  preview,
  onToggle,
  onStage,
  onRestart,
  onTarget,
  onEnd,
}: {
  session: MaskCadSession;
  entities: MaskCadEntity[];
  preview: { plan?: MaskCadPlan; error?: string };
  onToggle: (ref: MaskEntityRef) => void;
  onStage: () => void;
  onRestart: () => void;
  onTarget: (key: string) => void;
  onEnd: () => void;
}) {
  const [search, setSearch] = useState(''),
    [choice, setChoice] = useState('');
  const name = s.project.masks.find((m) => m.id === s.maskId)?.name;
  const list = entities.filter(
    (e) =>
      e.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
      (s.stage === 'limits' || e.mask.id === s.maskId),
  );
  return (
    <section
      className="mask-cad-panel"
      aria-label={
        s.mode === 'trim' ? 'Ajustar — Aparar / Trim' : 'Estender — Extend'
      }
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).closest('button'))
          e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onEnd();
        }
        if (
          (e.ctrlKey || e.metaKey) &&
          ['s', 'o'].includes(e.key.toLowerCase())
        ) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div className="transform-heading">
        <b>
          {s.mode === 'trim' ? 'Ajustar · Aparar / Trim' : 'Estender · Extend'}
        </b>
        <span>{s.stage === 'limits' ? '1/2 · Limites' : '2/2 · Trechos'}</span>
      </div>
      <p>
        <strong>{name}</strong> · {detailPath(s.project, s.context.detailId)} ·
        somente esta máscara recebe alterações.
      </p>
      <p>
        {s.stage === 'limits'
          ? 'Clique nas entidades limitadoras para adicionar/retirar. Enter confirma. Sem seleção, Enter usa todas as referências visíveis/capturáveis elegíveis, excluindo o próprio alvo.'
          : s.mode === 'trim'
            ? 'Clique dentro do intervalo a remover. Confira o realce vermelho antes do clique. Pode repetir cortes sem reiniciar.'
            : 'Clique no trecho terminal junto à ponta desejada. O primeiro encontro finito adiante aparece em verde. Pode repetir prolongamentos.'}
      </p>
      <p>
        {s.all
          ? 'Limites: todas as referências visíveis/capturáveis elegíveis.'
          : `Limites escolhidos: ${s.limits.length}.`}{' '}
        Limites finitos; sem extensão virtual.
      </p>
      <label className="field">
        Pesquisar entidade
        <input
          aria-label="Pesquisar entidades CAD"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {s.stage === 'limits' ? (
        <>
          <label className="field">
            Escolha inequívoca de limite
            <select
              aria-label="Entidade limitadora"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
            >
              <option value="">Escolher pelo nome/ID</option>
              {list.slice(0, 200).map((e) => (
                <option value={e.ref.key} key={e.ref.key}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!choice}
            onClick={() => {
              const e = entities.find((e) => e.ref.key === choice);
              if (e) onToggle(e.ref);
            }}
          >
            Adicionar / retirar limite
          </button>
          <button className="primary" onClick={onStage}>
            Confirmar limites · Enter
          </button>
        </>
      ) : (
        <>
          <label className="field">
            Alvo no clique
            <select
              aria-label="Entidade alvo CAD"
              value={s.selectedTarget ?? ''}
              onChange={(e) => onTarget(e.target.value)}
            >
              <option value="">Determinar pela posição do clique</option>
              {list.slice(0, 200).map((e) => (
                <option key={e.ref.key} value={e.ref.key}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={onRestart}>Escolher limites novamente</button>
        </>
      )}
      {list.length > 200 && (
        <p>
          Mostrando 200 de {list.length}. Refine a pesquisa; o clique no CAD
          continua disponível para todas.
        </p>
      )}
      {s.limits.length > 0 && (
        <p className="field-help">
          {s.limits
            .map(
              (r) =>
                `${s.project.masks.find((m) => m.id === r.maskId)?.name} #${r.index + 1}`,
            )
            .join(' · ')}
        </p>
      )}
      {preview.plan && (
        <p data-testid="mask-cad-result">
          {s.mode === 'trim' ? 'Remover' : 'Acrescentar'}{' '}
          {format(preview.plan.change.total, 6)} mm ·{' '}
          {preview.plan.remaining.length} remanescente(s).
        </p>
      )}
      {(s.issue || preview.error) && (
        <p role="alert">{s.issue || preview.error}</p>
      )}
      <p className="field-help">
        Tolerância: 0,000001 mm do modelo. Curvas nativas permanecem analíticas;
        referências já amostradas usam a aproximação disponível. O arquivo CAD
        original não é escrito. Enter encerra os trechos; Esc descarta a
        etapa/prévia atual e preserva operações já confirmadas.
      </p>
      <button onClick={onEnd}>
        {s.stage === 'targets'
          ? 'Concluir Ajustar/Estender'
          : 'Cancelar seleção de limites'}
      </button>
    </section>
  );
}
