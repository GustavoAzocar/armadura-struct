import type { Bar, Point, Project } from '../domain/types';
import type { VertexEdit } from '../domain/vertices';
import {
  barSegments,
  parseLength,
  terminalExtensionAt,
} from '../domain/segments';
import { format, world, geometry } from '../domain/geometry';
export type DimensionSettings = {
  segment: number;
  length: string;
  angle: string;
  keepDirection: boolean;
  fixed: 'start' | 'end';
  strategy: 'endpoint' | 'chain';
  convention: 'theoretical' | 'straight';
  extensionInput: 'increment' | 'final';
  picking: boolean;
};
export function initialDimensions(
  bar: Bar,
  lengthen = false,
): DimensionSettings {
  const m = barSegments(bar)[0];
  return {
    segment: 0,
    length: lengthen ? '' : String(m?.theoretical ?? 0),
    angle: String(m?.angle ?? 0),
    keepDirection: true,
    fixed: 'start',
    strategy: 'chain',
    convention: 'theoretical',
    extensionInput: 'increment',
    picking: lengthen,
  };
}
export function dimensionalMode(mode: VertexSession['mode']) {
  return mode === 'segment' || mode === 'lengthen';
}
export function vertexSessionEdits(
  s: VertexSession,
  cursorPreview = false,
): VertexEdit[] {
  if (!dimensionalMode(s.mode)) return s.edits;
  const bar = s.project.bars.find((b) => b.id === s.id);
  if (!bar) throw new Error('Selecione uma armadura física de barra livre.');
  const d = s.dimensions ?? initialDimensions(bar, s.mode === 'lengthen');
  if (s.mode === 'lengthen') {
    if (d.picking) {
      if (cursorPreview && s.cursor)
        return [terminalExtensionAt(bar, s.end, s.cursor).edit];
      throw new Error(
        'Clique para fixar a ponta proposta ou informe o valor em mm. Depois confirme a extensão.',
      );
    }
    const metrics = barSegments(bar),
      m = metrics[s.end === 'start' ? 0 : metrics.length - 1];
    const amount =
      parseLength(d.length) -
      (d.extensionInput === 'final' ? m.theoretical : 0);
    if (amount <= 0)
      throw new Error(
        'O comprimento final deve superar o trecho atual; o acréscimo deve ser positivo.',
      );
    return [{ kind: 'lengthen', end: s.end, amount }];
  }
  let angle: number | undefined;
  if (!d.keepDirection) {
    if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(d.angle.trim()))
      throw new Error('Informe um ângulo local finito em graus.');
    angle = Number(d.angle.replace(',', '.'));
  }
  return [
    {
      kind: 'segment',
      segment: d.segment,
      length: parseLength(d.length),
      angle,
      fixed: d.fixed,
      strategy: d.strategy,
      convention: d.convention,
    },
  ];
}
export type VertexSession = {
  project: Project;
  id: string;
  mode: 'insert' | 'extend' | 'remove' | 'segment' | 'lengthen';
  dimensions?: DimensionSettings;
  end: 'start' | 'end';
  edits: VertexEdit[];
  cursor?: Point;
  issue?: string;
};
export default function VertexPanel({
  value: s,
  onChange,
  count,
  onApply,
  onCancel,
  error,
  warnings,
  previewBar,
  canApply,
}: {
  value: VertexSession;
  onChange: (s: VertexSession) => void;
  count: number;
  onApply: () => void;
  onCancel: () => void;
  error?: string;
  warnings: string[];
  previewBar?: Bar;
  canApply?: boolean;
}) {
  if (dimensionalMode(s.mode)) {
    const bar = s.project.bars.find((b) => b.id === s.id)!;
    const d = s.dimensions ?? initialDimensions(bar, s.mode === 'lengthen');
    const rows = barSegments(bar),
      index =
        s.mode === 'lengthen'
          ? s.end === 'start'
            ? 0
            : rows.length - 1
          : d.segment;
    const before = rows[index],
      after = previewBar ? barSegments(previewBar)[index] : undefined;
    const tip =
      previewBar &&
      world(
        previewBar.points[s.end === 'start' ? 0 : previewBar.points.length - 1],
        previewBar,
      );
    const update = (patch: Partial<DimensionSettings>) =>
      onChange({
        ...s,
        dimensions: { ...d, ...patch },
        cursor: undefined,
        issue: undefined,
      });
    return (
      <section
        className="transform-panel dimensional-panel"
        aria-label="Edição dimensional da armadura"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            e.stopPropagation();
            onApply();
          }
        }}
      >
        <div className="transform-heading">
          <b>
            {s.mode === 'lengthen'
              ? 'Estender barra'
              : 'Comprimentos e ângulos'}
          </b>
          <span>mm do modelo · prévia</span>
        </div>
        <div className="dimensional-fields">
          <label className="field">
            <span>Operação</span>
            <select
              aria-label="Operação dimensional"
              value={s.mode}
              onChange={(e) =>
                onChange({
                  ...s,
                  mode: e.target.value as 'segment' | 'lengthen',
                  dimensions: initialDimensions(
                    bar,
                    e.target.value === 'lengthen',
                  ),
                  cursor: undefined,
                  issue: undefined,
                })
              }
            >
              <option value="segment">Editar segmento</option>
              <option value="lengthen">Estender trecho terminal</option>
            </select>
          </label>
          {s.mode === 'segment' ? (
            <>
              <label className="field">
                <span>Trecho</span>
                <select
                  aria-label="Segmento da barra"
                  value={d.segment}
                  onChange={(e) => {
                    const m = rows[Number(e.target.value)];
                    update({
                      segment: m.index,
                      length: String(
                        d.convention === 'straight'
                          ? m.straight
                          : m.theoretical,
                      ),
                      angle: String(m.angle),
                    });
                  }}
                >
                  {rows.map((r) => (
                    <option key={r.index} value={r.index}>
                      {r.index + 1} · vértices {r.index + 1}–{r.index + 2}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Convenção da medida</span>
                <select
                  aria-label="Convenção do comprimento"
                  value={d.convention}
                  onChange={(e) =>
                    update({
                      convention: e.target
                        .value as DimensionSettings['convention'],
                      length: String(
                        e.target.value === 'straight'
                          ? before.straight
                          : before.theoretical,
                      ),
                    })
                  }
                >
                  <option value="theoretical">Teórica · entre vértices</option>
                  <option value="straight">
                    Reta física · entre tangências
                  </option>
                </select>
              </label>
              <label className="field">
                <span>Ponta fixa do trecho</span>
                <select
                  aria-label="Ponta fixa do segmento"
                  value={d.fixed}
                  onChange={(e) =>
                    update({ fixed: e.target.value as 'start' | 'end' })
                  }
                >
                  <option value="start">Início</option>
                  <option value="end">Fim</option>
                </select>
              </label>
              <label className="field">
                <span>Estratégia</span>
                <select
                  aria-label="Estratégia de edição do segmento"
                  value={d.strategy}
                  onChange={(e) =>
                    update({
                      strategy: e.target.value as DimensionSettings['strategy'],
                    })
                  }
                >
                  <option value="chain">Deslocar vértices do lado móvel</option>
                  <option value="endpoint">
                    Mover somente a ponta do trecho
                  </option>
                </select>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={d.keepDirection}
                  onChange={(e) => update({ keepDirection: e.target.checked })}
                />
                Preservar direção do segmento
              </label>
              <label className="field">
                <span>Ângulo local · graus</span>
                <input
                  aria-label="Ângulo local do segmento (graus)"
                  inputMode="decimal"
                  value={d.angle}
                  disabled={d.keepDirection}
                  onChange={(e) => update({ angle: e.target.value })}
                />
              </label>
              <p>
                Ângulo do início para o fim no referencial local da barra; a
                rotação da armadura permanece própria. Mover só a ponta pode
                alterar a perna vizinha.
              </p>
            </>
          ) : (
            <>
              <label className="field">
                <span>Ponta da barra</span>
                <select
                  aria-label="Ponta a estender"
                  value={s.end}
                  onChange={(e) =>
                    onChange({
                      ...s,
                      end: e.target.value as 'start' | 'end',
                      cursor: undefined,
                      issue: undefined,
                    })
                  }
                >
                  <option value="end">Final</option>
                  <option value="start">Inicial</option>
                </select>
              </label>
              <label className="field">
                <span>Valor informado</span>
                <select
                  aria-label="Tipo de medida da extensão"
                  value={d.extensionInput}
                  onChange={(e) =>
                    update({
                      extensionInput: e.target.value as 'increment' | 'final',
                      length: '',
                      picking: false,
                    })
                  }
                >
                  <option value="increment">Acréscimo ao trecho (+mm)</option>
                  <option value="final">
                    Comprimento final do trecho (mm)
                  </option>
                </select>
              </label>
              <button onClick={() => update({ picking: true })}>
                Escolher ponto no CAD
              </button>
              <p>
                O clique é projetado na direção de saída do trecho terminal. Só
                a ponta se move; nenhuma dobra é criada. Para outra
                direção/perna, use CONTINUAR.
              </p>
            </>
          )}
          <label className="field">
            <span>
              {s.mode === 'segment'
                ? 'Comprimento do segmento · mm'
                : d.extensionInput === 'increment'
                  ? 'Acréscimo · mm'
                  : 'Comprimento final do trecho · mm'}
            </span>
            <input
              aria-label={
                s.mode === 'segment'
                  ? 'Comprimento do segmento (mm)'
                  : d.extensionInput === 'increment'
                    ? 'Acréscimo (mm)'
                    : 'Comprimento final do trecho (mm)'
              }
              inputMode="decimal"
              value={d.length}
              onChange={(e) =>
                update({ length: e.target.value, picking: false })
              }
            />
          </label>
          <p>
            Medidas em mm; sufixos mm, cm e m são aceitos. Não são coordenadas
            nem medidas de papel.
          </p>
          <p>
            Desenvolvido da barra (retas + arcos):{' '}
            {format(geometry(bar).length)} →{' '}
            {format(geometry(previewBar ?? bar).length)} mm.
          </p>
          {before && (
            <p data-testid="segment-measures">
              Trecho {index + 1}: teórico {format(before.theoretical)} →{' '}
              {format(after?.theoretical ?? before.theoretical)} mm; reta física{' '}
              {format(before.straight)} →{' '}
              {format(after?.straight ?? before.straight)} mm. Reta física
              exclui os arcos das dobras.
            </p>
          )}
          {s.mode === 'lengthen' && tip && after && (
            <p data-testid="extension-projection">
              Ponta proposta X {format(tip.x, 3)} · Y {format(tip.y, 3)} mm.
              Acréscimo +{format(after.theoretical - before.theoretical, 3)} mm;
              trecho final {format(after.theoretical, 3)} mm. Projeção sobre o
              eixo do trecho.
            </p>
          )}
          <p>
            Não verifica ancoragem nem traspasse normativo. Cotas manuais não
            são comandos de geometria.
          </p>
          {error && <p role="status">{error}</p>}
        </div>
        {after && !error && (
          <p
            className="dimensional-summary"
            aria-live="polite"
            data-testid="dimensional-quick-measure"
          >
            {s.mode === 'lengthen'
              ? `Acréscimo +${format(after.theoretical - before.theoretical, 3)} mm · final ${format(after.theoretical, 3)} mm`
              : `Trecho ${index + 1} · teórico ${format(after.theoretical)} mm · reta física ${format(after.straight)} mm`}
          </p>
        )}
        <div className="visibility-actions">
          <button className="primary" disabled={!canApply} onClick={onApply}>
            Aplicar dimensões
          </button>
          <button onClick={onCancel}>Cancelar dimensões</button>
        </div>
      </section>
    );
  }
  return (
    <section
      className="transform-panel"
      aria-label="Edição de vértices"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="transform-heading">
        <b>Editar vértices</b>
        <span>{count} ponto(s) · prévia</span>
      </div>
      <label className="field">
        <span>Operação</span>
        <select
          aria-label="Operação de vértices"
          value={s.mode}
          onChange={(e) =>
            onChange({
              ...s,
              mode: e.target.value as 'insert' | 'extend' | 'remove',
              cursor: undefined,
              issue: undefined,
            })
          }
        >
          <option value="insert">Inserir no segmento mais próximo</option>
          <option value="extend">Continuar pela ponta</option>
          <option value="remove">Remover o vértice mais próximo</option>
        </select>
      </label>
      {s.mode === 'extend' && (
        <label className="field">
          <span>Ponta</span>
          <select
            aria-label="Ponta de continuação"
            value={s.end}
            onChange={(e) =>
              onChange({
                ...s,
                end: e.target.value as 'start' | 'end',
                cursor: undefined,
                issue: undefined,
              })
            }
          >
            <option value="end">Final</option>
            <option value="start">Inicial</option>
          </select>
        </label>
      )}
      <p>
        {s.mode === 'extend'
          ? 'Clique ou digite as novas pontas; continue até Enter.'
          : s.mode === 'insert'
            ? 'Clique ou digite o ponto; ele entra no segmento mais próximo. Continue até Enter.'
            : 'Clique perto do vértice a remover. Continue até Enter.'}{' '}
        Coordenadas absolutas, @relativas e @distância&lt;ângulo são aceitas.
        Encaixes e Ortogonal continuam ativos.
      </p>
      <p>
        {s.edits.length} alteração(ões) pendente(s). A posição e os vínculos
        serão preservados.
      </p>
      {error && <p role="status">{error}</p>}
      {warnings.length > 0 && <p>{[...new Set(warnings)].join(' ')}</p>}
      <div className="visibility-actions">
        <button
          disabled={!s.edits.length}
          onClick={() =>
            onChange({ ...s, edits: s.edits.slice(0, -1), cursor: undefined })
          }
        >
          Desfazer vértice pendente
        </button>
        <button
          className="primary"
          disabled={!s.edits.length}
          onClick={onApply}
        >
          Concluir vértices
        </button>
        <button onClick={onCancel}>Cancelar vértices</button>
      </div>
    </section>
  );
}
