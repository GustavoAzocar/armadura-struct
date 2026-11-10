import { useState } from 'react';
import type { Point, Project } from '../domain/types';
import type { MaskDrawingContext } from '../domain/maskDrawing';
import type { MaskCadEntity, MaskEntityRef } from '../domain/maskCadEditing';
import {
  maskManipNames,
  type MaskManipMode,
  type MaskMoveScope,
} from '../domain/maskManipulation';
export type MaskManipSession = {
  project: Project;
  maskId: string;
  context: MaskDrawingContext;
  mode: MaskManipMode;
  stage: 'selection' | 'base' | 'target' | 'confirm';
  refs: MaskEntityRef[];
  /** Only Mover offers the whole mask; every other mode works on entities. */
  scope?: MaskMoveScope;
  base?: Point;
  cursor?: Point;
  axisEnd?: Point;
  removeSource?: boolean;
  hadOperations: boolean;
  issue?: string;
};
const mm = (n: number) =>
  `${n.toLocaleString('pt-BR', { maximumFractionDigits: 3, useGrouping: false })}`;
export default function MaskManipPanel({
  session: s,
  entities,
  onToggle,
  onConfirm,
  onCancel,
  error,
  onRemoveSource,
  onScope,
  hiddenFollowers = 0,
}: {
  session: MaskManipSession;
  entities: MaskCadEntity[];
  onToggle: (ref: MaskEntityRef) => void;
  onConfirm: () => void;
  onCancel: () => void;
  error?: string;
  onRemoveSource: (value: boolean) => void;
  onScope?: (scope: MaskMoveScope) => void;
  hiddenFollowers?: number;
}) {
  const [query, setQuery] = useState('');
  const whole = s.mode === 'move' && s.scope === 'mask';
  const mask = s.project.masks.find((m) => m.id === s.maskId);
  const delta =
    s.mode === 'move' && s.base && s.cursor
      ? { x: s.cursor.x - s.base.x, y: s.cursor.y - s.base.y }
      : undefined;
  return (
    <section
      className="mask-cad-panel"
      aria-label={`${maskManipNames[s.mode]} entidades da máscara`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          e.preventDefault();
          onCancel();
        }
        if (e.key === 'Enter') {
          e.stopPropagation();
          if (!(e.target as HTMLElement).closest('button')) {
            e.preventDefault();
            onConfirm();
          }
        }
      }}
    >
      <div className="transform-heading">
        <b>Manipular · {maskManipNames[s.mode]}</b>
        <span>
          {s.stage === 'selection'
            ? 'Selecionar entidades'
            : s.stage === 'base'
              ? s.mode === 'mirror'
                ? 'Primeiro ponto do eixo'
                : 'Ponto base'
              : s.stage === 'confirm'
                ? 'Apagar origem?'
                : s.mode === 'mirror'
                  ? 'Segundo ponto do eixo'
                  : 'Destino / prévia'}
        </span>
      </div>
      {whole ? (
        <p data-testid="mask-move-scope">
          <strong>{mask?.name}</strong> · alcance: <b>máscara inteira</b> —
          somente a origem é transladada; {mask?.primitives.length ?? 0}{' '}
          entidade(s) acompanham sem nova transformação local.
          {hiddenFollowers
            ? ` ${hiddenFollowers} delas estão em layers ocultos e também acompanham.`
            : ''}
        </p>
      ) : (
        <p data-testid={s.mode === 'move' ? 'mask-move-scope' : undefined}>
          <strong>{mask?.name}</strong> · {s.mode === 'move' ? 'alcance: ' : ''}
          {s.refs.length} entidade(s).{' '}
          {s.mode === 'move'
            ? 'Somente estas entidades se deslocam; origem, escala e rotação da máscara permanecem.'
            : 'A máscara inteira permanece.'}
        </p>
      )}
      {s.mode === 'move' && s.stage === 'selection' && onScope && (
        <fieldset className="field" aria-label="Alcance de Mover">
          <legend>Alcance</legend>
          <label>
            <input
              type="radio"
              name="mask-move-scope"
              checked={!whole}
              onChange={() => onScope('entities')}
            />
            Entidades selecionadas da máscara ativa
          </label>
          <label>
            <input
              type="radio"
              name="mask-move-scope"
              checked={whole}
              onChange={() => onScope('mask')}
            />
            Máscara inteira (origem)
          </label>
        </fieldset>
      )}
      {s.stage === 'selection' && whole ? (
        <p>
          Enter confirma a máscara inteira como alvo. Aço, outras máscaras e
          cotas externas não participam.
        </p>
      ) : s.stage === 'selection' ? (
        <>
          <p>
            Clique para acumular/retirar entidades ou selecione por nome/ID.
            Enter{' '}
            {s.mode === 'erase'
              ? 'apaga somente este conjunto'
              : 'confirma o conjunto'}
            . Aço e outras máscaras não participam.
          </p>
          <label className="field">
            Pesquisar entidades
            <input
              aria-label="Pesquisar entidades para manipular"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div
            className="mask-manip-list"
            role="group"
            aria-label="Entidades da máscara ativa"
          >
            {entities
              .filter(
                (e) =>
                  e.mask.id === s.maskId &&
                  e.label
                    .toLocaleLowerCase()
                    .includes(query.toLocaleLowerCase()),
              )
              .slice(0, 200)
              .map((e) => (
                <label key={e.ref.key}>
                  <input
                    type="checkbox"
                    checked={s.refs.some(
                      (r) => r.primitive === e.ref.primitive,
                    )}
                    onChange={() => onToggle(e.ref)}
                  />
                  {e.label}
                  {!e.editable ? ' · protegido' : ''}
                </label>
              ))}
          </div>
          <p>Até 200 resultados; refine a pesquisa para acessar os demais.</p>
        </>
      ) : (
        <p>
          {s.stage === 'base'
            ? s.mode === 'mirror'
              ? 'Clique no primeiro ponto do eixo ou informe coordenadas no Comando CAD.'
              : 'Clique no ponto base ou informe coordenadas no Comando CAD.'
            : s.mode === 'copy'
              ? 'Escolha destino(s) por clique/snap ou coordenadas. O conjunto original e a base permanecem para novas cópias. Enter/Esc encerra.'
              : s.mode === 'move'
                ? 'Clique no destino por snap/ortogonal ou informe X,Y, @dx,dy ou @distância<ângulo no Comando CAD. Uma única translação; Esc cancela.'
                : s.stage === 'confirm'
                  ? 'Eixo definido. Confira a prévia e confirme uma única operação.'
                  : s.mode === 'mirror'
                    ? 'Clique no segundo ponto do eixo por snap ou coordenadas. Eixo mínimo: 0,01 mm.'
                    : 'Clique no destino ou use coordenadas no Comando CAD.'}
        </p>
      )}
      {delta && (
        <p data-testid="mask-move-delta" aria-live="polite">
          Δ = ({mm(delta.x)}; {mm(delta.y)}) mm ·{' '}
          {mm(Math.hypot(delta.x, delta.y))} mm
        </p>
      )}
      {s.mode === 'mirror' && (
        <p>
          Textos: âncora refletida, caracteres legíveis, orientação entre −90° e
          90° e alinhamento compensado. Retângulo oblíquo usa quatro vértices
          exatos de polilinha fechada. Curvas importadas mantêm a representação
          disponível. Canvas/PDF/DXF usam segmentos (erro radial nativo até 0,05
          × escala mm); DXF escreve LWPOLYLINE. O projeto conserva círculo/arco
          analítico.
        </p>
      )}
      {s.stage === 'confirm' && (
        <>
          <label className="field">
            Apagar objetos de origem?
            <select
              aria-label="Apagar objetos de origem?"
              value={s.removeSource ? 'yes' : 'no'}
              onChange={(e) => onRemoveSource(e.target.value === 'yes')}
            >
              <option value="no">
                Não — manter originais e criar novos IDs (padrão)
              </option>
              <option value="yes">
                Sim — substituir entidades e preservar IDs
              </option>
            </select>
          </label>
          <button className="primary" disabled={!!error} onClick={onConfirm}>
            Confirmar espelhamento · Enter
          </button>
        </>
      )}
      <p className="field-help">
        Cotas existentes usam pontos estáticos, sem vínculo com entidades de
        máscara; revise-as após editar a referência. Armaduras permanecem
        independentes.
      </p>
      {(s.issue || error) && <p role="alert">{s.issue || error}</p>}
      {s.stage === 'selection' && (
        <button className="primary" onClick={onConfirm}>
          {s.mode === 'erase'
            ? 'Apagar seleção · Enter'
            : 'Confirmar seleção · Enter'}
        </button>
      )}
      <button onClick={onCancel}>
        {s.hadOperations ? 'Concluir Manipular' : 'Cancelar Manipular'}
      </button>
    </section>
  );
}
