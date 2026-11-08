import type { FollowEdge } from '../domain/followForm';
import { format } from '../domain/geometry';
export type FollowDraftValues = {
  cover: string;
  mandrel: string;
  extra: string;
  extraReason: string;
};
export default function FollowFormPanel({
  edges,
  order,
  mode,
  whole,
  values,
  defaultCover,
  diameter,
  quantity,
  side,
  offset,
  radius,
  length,
  adjustments,
  error,
  onValues,
  onMode,
  onWhole,
  onRemove,
  onClear,
  onFlip,
  onDefault,
  onCancel,
}: {
  edges: FollowEdge[];
  order: string[];
  mode: 'edges' | 'side';
  whole: boolean;
  values: FollowDraftValues;
  defaultCover: number;
  diameter: number;
  quantity: number;
  side?: string;
  offset?: number;
  radius?: number;
  length?: number;
  adjustments: number;
  error: string;
  onValues: (v: Partial<FollowDraftValues>) => void;
  onMode: (mode: 'edges' | 'side') => void;
  onWhole: (whole: boolean) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onFlip: () => void;
  onDefault: () => void;
  onCancel: () => void;
}) {
  const parsedMandrel = Number(values.mandrel.replace(',', '.'));
  const shownRadius =
    radius ??
    (values.mandrel.trim() &&
    Number.isFinite(parsedMandrel) &&
    parsedMandrel > 0
      ? (parsedMandrel + diameter) / 2
      : undefined);
  return (
    <section className="follow-panel" aria-label="Seguir fôrma por trechos">
      <div className="follow-actions">
        <b>SEGUIR FÔRMA · {edges.length} trecho(s)</b>
        <button aria-pressed={mode === 'edges'} onClick={() => onMode('edges')}>
          Selecionar / retirar trechos
        </button>
        <button
          aria-pressed={mode === 'side'}
          disabled={!edges.length}
          onClick={() => onMode('side')}
        >
          Escolher lado no CAD
        </button>
        <label>
          <input
            type="checkbox"
            checked={whole}
            onChange={(e) => onWhole(e.target.checked)}
          />
          Polilinha inteira
        </label>
        <button disabled={!side} onClick={onFlip}>
          Inverter lado
        </button>
        <button disabled={!edges.length} onClick={onClear}>
          Limpar trechos
        </button>
        <button onClick={onCancel}>Cancelar Seguir fôrma</button>
      </div>
      <div className="follow-parameters">
        {(
          [
            ['cover', 'Cobrimento neste lançamento'],
            ['mandrel', 'Mandril neste lançamento'],
            ['extra', 'Afastamento adicional informado'],
          ] as const
        ).map(([key, label]) => (
          <label className="field" key={key}>
            {label} ({key === 'mandrel' ? 'diâmetro interno, mm' : 'mm'})
            <input
              aria-label={label}
              inputMode="decimal"
              value={values[key]}
              onChange={(e) => onValues({ [key]: e.target.value })}
            />
          </label>
        ))}
        <span>
          Ø {diameter} mm · {quantity} peça(s) · raio do eixo{' '}
          {shownRadius === undefined ? '—' : format(shownRadius, 2)} mm
        </span>
        <span>
          Padrão atual: {defaultCover} mm · controle rápido da sessão.{' '}
          <button onClick={onDefault}>Usar cobrimento padrão</button>
        </span>
        {Number(values.extra.replace(',', '.')) > 0 && (
          <label className="field">
            Premissa explícita do adicional
            <input
              aria-label="Premissa do afastamento adicional"
              maxLength={200}
              value={values.extraReason}
              onChange={(e) => onValues({ extraReason: e.target.value })}
            />
          </label>
        )}
      </div>
      <p role="status">
        {mode === 'edges'
          ? 'Clique nas arestas da máscara; outro clique retira. Nenhum aço foi criado. Depois escolha o lado.'
          : 'Clique no lado desejado, afastado da linha. Confira a prévia e pressione Enter fora dos campos para criar.'}{' '}
        {side ? `${side}.` : 'Lado ainda não escolhido.'}{' '}
        {offset === undefined
          ? ''
          : `Eixo = c + Ø/2 + adicional = ${format(offset, 2)} mm.`}{' '}
        {length === undefined
          ? ''
          : `Desenvolvimento: ${format(length, 3)} mm.`}
      </p>
      {error && <p role="alert">{error}</p>}
      {adjustments > 0 && (
        <p>
          Pontas ajustadas em até 0,1 mm: {adjustments}. A máscara original será
          preservada.
        </p>
      )}
      {!!edges.length && (
        <details>
          <summary>Trechos e ordem da cadeia ({edges.length})</summary>
          <ol className="follow-edge-list">
            {(order.length
              ? order.map((key) => edges.find((e) => e.key === key)!)
              : edges
            ).map((e) => (
              <li key={e.key}>
                {e.label}
                <button
                  aria-label={`Retirar ${e.label}`}
                  onClick={() => onRemove(e.key)}
                >
                  Retirar
                </button>
              </li>
            ))}
          </ol>
        </details>
      )}
      <small>
        Cobrimento: face selecionada → superfície da barra. Sem desconto axial
        nas pontas. Adicional somente por premissa informada. Referências são
        trechos retos normalizados; curvas CAD amostradas não são arcos físicos.
        O mandril inicial 5Ø é uma convenção editável do editor, sem validação
        normativa.
      </small>
    </section>
  );
}
