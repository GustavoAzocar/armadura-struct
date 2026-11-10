import { useState } from 'react';
import type { Point, Project } from '../domain/types';
import type { MaskDrawingContext } from '../domain/maskDrawing';
import type { MaskCadEntity, MaskEntityRef } from '../domain/maskCadEditing';
import {
  maskManipNames,
  type MaskManipMode,
  type MaskManipScope,
} from '../domain/maskManipulation';
import { RotationAngleField } from './TransformPanel';
export type MaskManipSession = {
  project: Project;
  maskId: string;
  context: MaskDrawingContext;
  mode: MaskManipMode;
  stage:
    | 'selection'
    | 'base'
    | 'target'
    | 'confirm'
    | 'reference-start'
    | 'reference-end';
  referenceStart?: Point;
  referenceAngle?: number;
  angle?: number;
  refs: MaskEntityRef[];
  /** Only Mover offers the whole mask; every other mode works on entities. */
  scope?: MaskManipScope;
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
  previewAngle,
  onAngle,
  onReference,
  onChangeAngle,
}: {
  session: MaskManipSession;
  entities: MaskCadEntity[];
  onToggle: (ref: MaskEntityRef) => void;
  onConfirm: () => void;
  onCancel: () => void;
  error?: string;
  onRemoveSource: (value: boolean) => void;
  onScope?: (scope: MaskManipScope) => void;
  hiddenFollowers?: number;
  previewAngle?: number;
  onAngle: (angle: number) => void;
  onReference: () => void;
  onChangeAngle: () => void;
}) {
  const [query, setQuery] = useState('');
  const whole = s.scope === 'mask';
  const mask = s.project.masks.find((m) => m.id === s.maskId);
  const delta =
    s.mode === 'move' && s.base && s.cursor
      ? { x: s.cursor.x - s.base.x, y: s.cursor.y - s.base.y }
      : undefined;
  const rotating = s.mode === 'rotate';
  const rotationStep = {
    selection: 'Selecionar alvo',
    base: 'Ponto base',
    target:
      s.referenceAngle === undefined ? 'Ângulo / direção' : 'Nova direção',
    confirm: 'Confirmar rotação',
    'reference-start': 'Referência · primeiro ponto',
    'reference-end': 'Referência · segundo ponto',
  }[s.stage];
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
          if (
            !(e.target as HTMLElement).closest(
              'button, select, input[inputmode=decimal]',
            )
          ) {
            e.preventDefault();
            onConfirm();
          }
        }
      }}
    >
      <div className="transform-heading">
        <b>Manipular · {maskManipNames[s.mode]}</b>
        <span>
          {rotating
            ? rotationStep
            : s.stage === 'selection'
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
      {s.mode === 'move' && whole ? (
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
          {rotating && whole
            ? 'Máscara inteira'
            : `${s.refs.length} entidade(s).`}{' '}
          {s.mode === 'move'
            ? 'Somente estas entidades se deslocam; origem, escala e rotação da máscara permanecem.'
            : rotating
              ? whole
                ? ''
                : 'Entidades selecionadas'
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
      {rotating && s.stage === 'selection' && (
        <label className="field">
          Alvo da rotação
          <select
            value={whole ? 'mask' : 'entities'}
            onChange={(e) =>
              onScope?.(e.target.value === 'mask' ? 'mask' : 'entities')
            }
          >
            <option value="entities">Entidades da máscara ativa</option>
            <option value="mask">Máscara inteira</option>
          </select>
        </label>
      )}
      {s.stage === 'selection' ? (
        whole ? (
          <p>
            {rotating
              ? 'Enter confirma a máscara inteira. Todos os seus layers devem permitir edição.'
              : 'Enter confirma a máscara inteira como alvo. Aço, outras máscaras e cotas externas não participam.'}
          </p>
        ) : (
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
        )
      ) : rotating ? (
        <>
          <p>
            {
              {
                base: 'Clique no ponto base por snap ou informe coordenadas no Comando CAD.',
                target:
                  'Clique na direção a partir da base ou digite um ângulo. 0° aponta para +X.',
                confirm: 'Confira a prévia e confirme uma vez.',
                'reference-start':
                  'Indique o primeiro ponto da direção existente ou digite seu ângulo.',
                'reference-end':
                  'Indique o segundo ponto da direção existente.',
              }[s.stage]
            }
          </p>
          {(s.stage === 'target' || s.stage === 'reference-start') && (
            <RotationAngleField
              key={s.stage}
              label={
                s.stage === 'reference-start'
                  ? 'Ângulo de referência'
                  : s.referenceAngle === undefined
                    ? 'Ângulo de rotação'
                    : 'Ângulo da nova direção'
              }
              onChange={onAngle}
            />
          )}
          {s.stage === 'target' && (
            <button onClick={onReference}>
              {s.referenceAngle === undefined
                ? 'Referência'
                : 'Redefinir referência'}
            </button>
          )}
          {s.base && (
            <p aria-live={s.stage === 'confirm' ? 'polite' : 'off'}>
              Ângulo de rotação
              {previewAngle === undefined
                ? ' · positivo anti-horário (+)'
                : ` · ${previewAngle > 0 ? '+' : ''}${previewAngle.toLocaleString('pt-BR', { maximumFractionDigits: 6 })}° · positivo anti-horário (+)`}
            </p>
          )}
          {s.stage === 'confirm' && (
            <>
              <button
                className="primary"
                disabled={!!error}
                onClick={onConfirm}
              >
                Confirmar rotação · Enter
              </button>
              <button onClick={onChangeAngle}>Alterar ângulo</button>
            </>
          )}
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
      {s.mode === 'mirror' && s.stage === 'confirm' && (
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
      {rotating &&
        !whole &&
        s.refs.some((r) => r.primitive.native?.kind === 'rectangle') && (
          <p className="field-help">
            Retângulos oblíquos passam a contornos fechados com quatro vértices
            exatos.
          </p>
        )}
      {rotating &&
        s.stage === 'confirm' &&
        (whole ? mask?.primitives : s.refs.map((r) => r.primitive))?.some(
          (q) => q.native?.kind === 'circle' || q.native?.kind === 'arc',
        ) && (
          <p className="field-help">
            O projeto conserva curvas analíticas. PDF e DXF usam os segmentos da
            saída existente.
          </p>
        )}
      {rotating && !!mask?.warnings.length && (
        <p className="field-help">
          A rotação usa a geometria disponível no projeto. Confira os avisos da
          referência no Controle de máscaras.
        </p>
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
