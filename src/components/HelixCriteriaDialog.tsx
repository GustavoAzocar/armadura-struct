import { useEffect, useRef, useState } from 'react';
import { helixBar } from '../domain/helixBars';
import {
  helixMemory,
  helixMetrics,
  helixAxisDiameter,
  formatTurns,
} from '../domain/helix';
import { helixProjection } from '../domain/helixViews';
import type {
  HelixCriteria,
  HelixDiameter,
  HelixProfile,
} from '../domain/helixSchema';
import { format } from '../domain/geometry';
import type { Bar } from '../domain/types';

export default function HelixCriteriaDialog({
  initial,
  editMark,
  issue,
  onAccept,
  onClose,
}: {
  initial: HelixCriteria;
  editMark?: string;
  issue?: string;
  onAccept: (c: HelixCriteria) => void;
  onClose: () => void;
}) {
  const [c, set] = useState(() => structuredClone(initial));
  const [tab, setTab] = useState('Peça');
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLElement>('input,select')?.focus();
    return () => {
      dialog.current?.close();
      if (old?.isConnected) old.focus();
    };
  }, []);
  const change = (patch: Partial<HelixCriteria>) => {
    set((v) => ({ ...v, ...patch }));
    setError('');
  };
  const profile = (patch: Partial<HelixProfile>) =>
    change({ profile: { ...c.profile, ...patch } });
  const diameter = (patch: Partial<HelixDiameter>) =>
    profile({
      diameter: { ...c.profile.diameter, ...patch } as HelixDiameter,
    });
  let preview: Bar | undefined,
    previewIssue = '';
  try {
    preview = helixBar(c, { x: 0, y: 0 }, 0, 'N?', 'preview');
  } catch (e) {
    previewIssue = (e as Error).message;
  }
  const num = (
    label: string,
    value: number,
    update: (v: number) => void,
    options: { min?: number; integer?: boolean; help?: string } = {},
  ) => (
    <label className="field">
      {label}
      <input
        aria-label={label}
        type="number"
        step={options.integer ? 1 : 'any'}
        min={options.min ?? 0}
        value={Number.isNaN(value) ? '' : value}
        required
        onChange={(e) =>
          update(e.target.value === '' ? NaN : Number(e.target.value))
        }
      />
      {options.help && <small>{options.help}</small>}
    </label>
  );
  const d = c.profile.diameter;
  const axis = helixAxisDiameter(d, c.diameter);
  return (
    <dialog
      ref={dialog}
      className="modal stirrup-dialog helix-dialog"
      aria-labelledby="helix-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (previewIssue) {
            setError(previewIssue);
            return;
          }
          onAccept(c);
        }}
      >
        <div className="panel-heading">
          <b id="helix-title">
            {editMark
              ? `Editar estribo helicoidal ${editMark}`
              : 'Critérios do helicoidal'}
          </b>
          <button
            type="button"
            aria-label="Fechar critérios do helicoidal"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <nav
          className="stirrup-tabs"
          aria-label="Etapas dos critérios do helicoidal"
        >
          {['Peça', 'Trecho', 'Quantidade', 'Representação'].map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="stirrup-dialog-body helix-dialog-body">
          <div>
            {tab === 'Peça' && (
              <>
                <p className="field-help">
                  Uma única peça contínua, com diâmetro e passo constantes. Cada
                  volta pertence à mesma barra; não há ganchos de estribo,
                  fechamento ou distribuição por faixa.
                </p>
                <div className="fields-2">
                  <label className="field">
                    Aço
                    <select
                      aria-label="Aço do helicoidal"
                      value={c.steel}
                      onChange={(e) =>
                        change({
                          steel: e.target.value as HelixCriteria['steel'],
                        })
                      }
                    >
                      <option>CA-50</option>
                      <option>CA-60</option>
                    </select>
                  </label>
                  {num(
                    'Bitola φ (mm)',
                    c.diameter,
                    (v) => change({ diameter: v }),
                    { min: 0.001 },
                  )}
                </div>
                <label className="field">
                  Referência do diâmetro da hélice
                  <select
                    aria-label="Referência do diâmetro da hélice"
                    value={d.reference}
                    onChange={(e) => {
                      const reference = e.target
                        .value as HelixDiameter['reference'];
                      profile({
                        diameter:
                          reference === 'concrete'
                            ? {
                                reference,
                                value: d.value,
                                cover: d.reference === 'concrete' ? d.cover : 0,
                              }
                            : { reference, value: d.value },
                      });
                    }}
                  >
                    <option value="axis">Diâmetro no eixo da barra (D)</option>
                    <option value="external">
                      Diâmetro externo da hélice (envelope do aço)
                    </option>
                    <option value="concrete">
                      Diâmetro da seção de concreto + cobrimento
                    </option>
                  </select>
                </label>
                <div className="fields-2">
                  {num(
                    d.reference === 'axis'
                      ? 'Diâmetro no eixo D (mm)'
                      : d.reference === 'external'
                        ? 'Diâmetro externo Dext (mm)'
                        : 'Diâmetro da seção de concreto (mm)',
                    d.value,
                    (value) => diameter({ value }),
                    { min: 0.001 },
                  )}
                  {d.reference === 'concrete' &&
                    num(
                      'Cobrimento radial c até a face externa da hélice (mm)',
                      d.cover,
                      (cover) => diameter({ cover }),
                    )}
                </div>
                <p className="field-help" data-testid="helix-axis-diameter">
                  {d.reference === 'axis'
                    ? 'D = valor informado'
                    : d.reference === 'external'
                      ? 'D = Dext − φ'
                      : 'D = Dconcreto − 2c − φ'}{' '}
                  ={' '}
                  <b>
                    {Number.isFinite(axis) ? format(axis, 3) : '—'} mm no eixo
                  </b>
                  . O desenvolvimento usa D, nunca o diâmetro da estaca. O
                  cobrimento é informado pelo projetista; não é deduzido da
                  fôrma nem das barras longitudinais.
                </p>
                {num(
                  'Passo axial p (mm)',
                  c.profile.pitch,
                  (pitch) => profile({ pitch }),
                  {
                    min: 0.001,
                    help: 'Avanço ao longo do eixo a cada volta completa; não é distância livre entre barras nem espaçamento de peças.',
                  },
                )}
              </>
            )}
            {tab === 'Trecho' && (
              <>
                <p className="field-help">
                  A e B são os centros das seções inicial e final no eixo. No
                  lançamento por dois pontos, Hbruto = |B − A| é medido em
                  verdadeira grandeza. Na entrada numérica, o comprimento abaixo
                  é a fonte declarada.
                </p>
                <div className="fields-2">
                  <label className="field">
                    Comprimento declarado
                    <select
                      aria-label="Comprimento declarado"
                      value={c.profile.span.source}
                      onChange={(e) =>
                        profile({
                          span: {
                            ...c.profile.span,
                            source: e.target.value as 'gross' | 'useful',
                          },
                        })
                      }
                    >
                      <option value="gross">Trecho bruto A–B (Hbruto)</option>
                      <option value="useful">Trecho útil (H)</option>
                    </select>
                  </label>
                  {num(
                    c.profile.span.source === 'gross'
                      ? 'Hbruto (mm)'
                      : 'H útil (mm)',
                    c.profile.span.value,
                    (value) => profile({ span: { ...c.profile.span, value } }),
                    { min: 0.001 },
                  )}
                  {num(
                    'Afastamento inicial a (mm)',
                    c.profile.startOffset,
                    (startOffset) => profile({ startOffset }),
                  )}
                  {num(
                    'Afastamento final b (mm)',
                    c.profile.endOffset,
                    (endOffset) => profile({ endOffset }),
                  )}
                </div>
                <p className="field-help">
                  H = Hbruto − a − b. Modo inicial: passo fixo e extremos
                  preservados; a última volta pode ser fracionária. O número de
                  voltas não é arredondado e o passo não é alterado para fechar
                  a hélice.
                </p>
                <details className="compact-fields" open>
                  <summary>Opções avançadas · sentido e fase</summary>
                  <label className="field">
                    Sentido de enrolamento
                    <select
                      aria-label="Sentido de enrolamento"
                      value={c.profile.hand}
                      onChange={(e) =>
                        profile({ hand: e.target.value as 'right' | 'left' })
                      }
                    >
                      <option value="right">
                        À direita (destro, como rosca comum)
                      </option>
                      <option value="left">À esquerda (sinistro)</option>
                    </select>
                  </label>
                  {num(
                    'Ângulo inicial θ0 (°)',
                    c.profile.phase,
                    (phase) => profile({ phase }),
                    {
                      min: -360,
                      help: '0° = ponto inicial do lado superior do eixo na vista longitudinal (normal ao eixo, à esquerda de A→B); 90° = voltado ao observador.',
                    },
                  )}
                  <p className="field-help">
                    Convenção: olhando de B para A, a hélice à direita gira no
                    sentido anti-horário ao avançar de A para B. Na vista, o
                    trecho à frente é contínuo e o do fundo, tracejado.
                  </p>
                </details>
              </>
            )}
            {tab === 'Quantidade' && (
              <>
                <div className="fields-2">
                  {num(
                    'Quantidade de hélices idênticas',
                    c.quantity,
                    (quantity) => change({ quantity }),
                    { min: 1, integer: true },
                  )}
                  {num(
                    'Multiplicador da armadura',
                    c.multiplier,
                    (multiplier) => change({ multiplier }),
                    { min: 1, integer: true },
                  )}
                </div>
                <p className="field-help">
                  Uma unidade é uma hélice contínua completa. O número de voltas
                  é resultado da geometria e não multiplica a quantidade. Total
                  físico = hélices × multiplicador × repetição do detalhamento.
                </p>
              </>
            )}
            {tab === 'Representação' && (
              <>
                {(['dimensions', 'identification', 'section'] as const).map(
                  (key) => (
                    <label className="check" key={key}>
                      <input
                        type="checkbox"
                        checked={c.display[key]}
                        onChange={(e) =>
                          change({
                            display: { ...c.display, [key]: e.target.checked },
                          })
                        }
                      />
                      {
                        {
                          dimensions: 'Mostrar cotas reais (D, H, p)',
                          identification: 'Mostrar identificação',
                          section: 'Mostrar seção circular vinculada',
                        }[key]
                      }
                    </label>
                  ),
                )}
                <p className="field-help">
                  A vista longitudinal é uma projeção esquemática da mesma peça;
                  a seção também. Nenhuma das duas acrescenta aço, e o traçado
                  nunca é usado para medir o comprimento.
                </p>
              </>
            )}
          </div>
          <div className="stirrup-shape-preview helix-previews">
            {preview ? (
              <>
                <HelixDiagram bar={preview} />
                <HelixMemoryTable bar={preview} />
              </>
            ) : (
              <p>Preencha medidas compatíveis para visualizar a hélice.</p>
            )}
          </div>
        </div>
        {(previewIssue || error || issue) && (
          <p className="stirrup-error" role="alert">
            {previewIssue || error || issue}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={!!previewIssue}>
            {editMark ? 'Aplicar alterações' : 'Indicar o eixo da hélice'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function HelixMemoryTable({
  bar,
  quantity,
}: {
  bar: Bar;
  quantity?: { quantity: number; multiplier: number; repetitions: number };
}) {
  return (
    <table className="helix-memory" aria-label="Memória do helicoidal">
      <tbody>
        {helixMemory(bar, quantity).map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Explanatory longitudinal projection (front solid, back dashed) and section. */
export function HelixDiagram({ bar }: { bar: Bar }) {
  const m = helixMetrics(bar);
  if (m.errors.length) return null;
  const { front, back } = helixProjection(m, 0.2);
  const margin = Math.max(m.gross, m.D) * 0.08 + 20;
  const sectionX = m.gross + m.D * 0.75 + m.R;
  const width = sectionX + m.R + 2 * margin;
  const height = m.D + 3 * margin;
  const line = (points: { x: number; y: number }[]) =>
    points.map((p) => `${p.x},${-p.y}`).join(' ');
  const stroke = Math.max(width, height) / 320;
  return (
    <figure>
      <figcaption>
        Projeção longitudinal esquemática · {formatTurns(m.turns)} voltas · p ={' '}
        {format(m.pitch, 1)} mm
      </figcaption>
      <svg
        role="img"
        aria-label="Prévia esquemática do estribo helicoidal"
        viewBox={`${-margin} ${-m.R - 1.5 * margin} ${width} ${height}`}
      >
        <line
          x1={0}
          y1={0}
          x2={m.gross}
          y2={0}
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={`${stroke * 8} ${stroke * 3} ${stroke} ${stroke * 3}`}
          opacity=".5"
        />
        {[m.start, m.end].map((x) => (
          <line
            key={x}
            x1={x}
            x2={x}
            y1={-m.R - margin / 2}
            y2={m.R + margin / 2}
            stroke="currentColor"
            strokeWidth={stroke}
            opacity=".6"
          />
        ))}
        {back.map((points, i) => (
          <polyline
            key={`b${i}`}
            points={line(points)}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke * 1.4}
            strokeDasharray={`${stroke * 4} ${stroke * 3}`}
            opacity=".55"
          />
        ))}
        {front.map((points, i) => (
          <polyline
            key={`f${i}`}
            points={line(points)}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke * 2.2}
          />
        ))}
        <circle
          cx={sectionX}
          cy={0}
          r={m.R}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke * 2.2}
        />
        <text
          x={0}
          y={-m.R - margin * 0.7}
          textAnchor="middle"
          fill="currentColor"
          fontSize={margin * 0.6}
        >
          A
        </text>
        <text
          x={m.gross}
          y={-m.R - margin * 0.7}
          textAnchor="middle"
          fill="currentColor"
          fontSize={margin * 0.6}
        >
          B
        </text>
        <text
          x={sectionX}
          y={m.R + margin}
          textAnchor="middle"
          fill="currentColor"
          fontSize={margin * 0.5}
        >
          D = {format(m.D, 1)} mm
        </text>
      </svg>
      <small>
        Frente contínua, fundo tracejado. Sem ganchos, anéis terminais, voltas
        extras ou transpasse nesta versão (hipótese de cálculo, não recomendação
        construtiva).
      </small>
    </figure>
  );
}
