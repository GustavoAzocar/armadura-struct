import { useEffect, useRef, useState } from 'react';
import { beamClampBar } from '../domain/beamClamps';
import type {
  BeamClampCriteria,
  BeamClampView,
} from '../domain/beamClampSchema';
import {
  beamClampViewPoint,
  beamClampViewPoints,
} from '../domain/beamClampViews';
import { bounds, format, geometry, sampled } from '../domain/geometry';
import type { Bar } from '../domain/types';

export default function BeamClampCriteriaDialog({
  initial,
  editMark,
  issue,
  onAccept,
  onClose,
}: {
  initial: BeamClampCriteria;
  editMark?: string;
  issue?: string;
  onAccept: (c: BeamClampCriteria) => void;
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
  const change = (patch: Partial<BeamClampCriteria>) => {
    set((v) => ({ ...v, ...patch }));
    setError('');
  };
  const profile = (patch: Partial<BeamClampCriteria['profile']>) =>
    change({ profile: { ...c.profile, ...patch } });
  let preview: Bar | undefined,
    previewIssue = '';
  try {
    preview = beamClampBar(c, { x: 0, y: 0 }, 'N?', 'preview');
    const errors = geometry(preview).errors;
    if (errors.length) previewIssue = errors.join(' ');
  } catch (e) {
    previewIssue = (e as Error).message;
  }
  const num = (
    label: string,
    value: number,
    update: (v: number) => void,
    min = 0,
    integer = false,
  ) => (
    <label className="field">
      {label}
      <input
        aria-label={label}
        type="number"
        step={integer ? 1 : 'any'}
        min={min}
        value={Number.isNaN(value) ? '' : value}
        required
        onChange={(e) =>
          update(e.target.value === '' ? NaN : Number(e.target.value))
        }
      />
    </label>
  );
  return (
    <dialog
      ref={dialog}
      className="modal stirrup-dialog beam-clamp-dialog"
      aria-labelledby="beam-clamp-title"
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
          <b id="beam-clamp-title">
            {editMark
              ? `Editar grampo de viga ${editMark}`
              : 'Critérios do grampo de viga'}
          </b>
          <button
            type="button"
            aria-label="Fechar critérios do grampo de viga"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <nav
          className="stirrup-tabs"
          aria-label="Etapas dos critérios do grampo"
        >
          {['Peça', 'Quantidade', 'Representação'].map((t) => (
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
        <div className="stirrup-dialog-body beam-clamp-dialog-body">
          <div>
            {tab === 'Peça' && (
              <>
                <p className="field-help">
                  Grampo em U: duas pernas e uma ligação transversal. L e T são
                  medidas no eixo até os vértices teóricos, antes do
                  arredondamento.
                </p>
                <div className="fields-2">
                  {num(
                    'Comprimento longitudinal L (mm)',
                    c.profile.longitudinal,
                    (longitudinal) => profile({ longitudinal }),
                    0.001,
                  )}
                  {num(
                    'Dimensão transversal T (mm)',
                    c.profile.transverse,
                    (transverse) => profile({ transverse }),
                    0.001,
                  )}
                  {num(
                    'Bitola (mm)',
                    c.diameter,
                    (diameter) => change({ diameter }),
                    0.001,
                  )}
                  {num(
                    'Mandril interno (mm)',
                    c.mandrel,
                    (mandrel) => change({ mandrel }),
                    0.001,
                  )}
                  <label className="field">
                    Aço
                    <select
                      aria-label="Aço do grampo"
                      value={c.steel}
                      onChange={(e) =>
                        change({
                          steel: e.target.value as BeamClampCriteria['steel'],
                        })
                      }
                    >
                      <option>CA-50</option>
                      <option>CA-60</option>
                    </select>
                  </label>
                  {num(
                    'Ângulo da peça (°)',
                    c.rotation,
                    (rotation) => change({ rotation }),
                    -360000,
                  )}
                </div>
                <label className="field">
                  Lado fechado do U
                  <select
                    aria-label="Dobra do grampo"
                    value={c.view.closedSide}
                    onChange={(e) =>
                      change({
                        view: {
                          ...c.view,
                          closedSide: e.target
                            .value as BeamClampView['closedSide'],
                        },
                      })
                    }
                  >
                    <option value="left">
                      Dobra à esquerda · pontas à direita
                    </option>
                    <option value="right">
                      Dobra à direita · pontas à esquerda
                    </option>
                  </select>
                </label>
                {(['start', 'end'] as const).map((end, i) => {
                  const h = c.profile[end],
                    update = (patch: Partial<typeof h>) =>
                      profile({ [end]: { ...h, ...patch } });
                  return (
                    <fieldset key={end}>
                      <legend>
                        Ponta aberta {i + 1} · terminação geométrica
                      </legend>
                      <div className="fields-2">
                        <label className="field">
                          Gancho
                          <select
                            aria-label={`Ângulo do gancho ${i + 1}`}
                            value={h.angle}
                            onChange={(e) =>
                              update({
                                angle: Number(e.target.value) as typeof h.angle,
                              })
                            }
                          >
                            {[0, 90, 135, 180].map((a) => (
                              <option key={a} value={a}>
                                {a ? `${a}°` : 'Sem gancho'}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          Sentido
                          <select
                            aria-label={`Sentido do gancho ${i + 1}`}
                            value={h.turn}
                            onChange={(e) =>
                              update({ turn: Number(e.target.value) as 1 | -1 })
                            }
                          >
                            <option value={-1}>Horário</option>
                            <option value={1}>Anti-horário</option>
                          </select>
                        </label>
                        {num(
                          `Trecho reto do gancho ${i + 1}`,
                          h.length,
                          (length) => update({ length }),
                        )}
                        <label className="field">
                          Unidade
                          <select
                            aria-label={`Unidade do gancho ${i + 1}`}
                            value={h.mode}
                            onChange={(e) =>
                              update({ mode: e.target.value as typeof h.mode })
                            }
                          >
                            <option value="mm">mm · valor explícito</option>
                            <option value="diameters">
                              × bitola · valor derivado
                            </option>
                          </select>
                        </label>
                      </div>
                      <small>
                        Reto efetivo:{' '}
                        {format(
                          h.mode === 'diameters'
                            ? h.length * c.diameter
                            : h.length,
                          2,
                        )}{' '}
                        mm.{' '}
                        {h.angle
                          ? 'Arco e trecho reto somados pela geometria real.'
                          : 'Sem comprimento adicional implícito.'}
                      </small>
                    </fieldset>
                  );
                })}
                <p className="field-help">
                  Bitola, mandril e terminações são definidos pelo projetista. A
                  ferramenta detalha a fabricação; não dimensiona ancoragem.
                </p>
              </>
            )}
            {tab === 'Quantidade' && (
              <>
                <div className="fields-2">
                  {num(
                    'Quantidade de grampos',
                    c.quantity,
                    (quantity) => change({ quantity }),
                    1,
                    true,
                  )}
                  {num(
                    'Multiplicador',
                    c.multiplier,
                    (multiplier) => change({ multiplier }),
                    1,
                    true,
                  )}
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={c.distribute}
                    onChange={(e) => change({ distribute: e.target.checked })}
                  />
                  Distribuir grampos em uma faixa
                </label>
                {c.distribute && (
                  <>
                    <label className="field">
                      Contagem da faixa
                      <select
                        aria-label="Contagem da faixa de grampos"
                        value={c.distributionMode}
                        onChange={(e) =>
                          change({
                            distributionMode: e.target
                              .value as BeamClampCriteria['distributionMode'],
                          })
                        }
                      >
                        <option value="manual">
                          Quantidade manual · faixa gráfica
                        </option>
                        <option value="quantity">Quantidade fixa</option>
                        <option value="spacing">Espaçamento</option>
                      </select>
                    </label>
                    {c.distributionMode === 'spacing' && (
                      <div className="fields-2">
                        {num(
                          'Passo da faixa (mm)',
                          c.spacing,
                          (spacing) => change({ spacing }),
                          0.001,
                        )}
                        <label className="field">
                          Política do passo
                          <select
                            aria-label="Política do passo do grampo"
                            value={c.fit}
                            onChange={(e) =>
                              change({
                                fit: e.target.value as BeamClampCriteria['fit'],
                              })
                            }
                          >
                            <option value="maximum">Passo máximo</option>
                            <option value="fixed">Passo fixo</option>
                          </select>
                        </label>
                      </div>
                    )}
                    <div className="fields-2">
                      {num(
                        'Afastamento inicial (mm)',
                        c.startInset,
                        (startInset) => change({ startInset }),
                      )}
                      {num('Afastamento final (mm)', c.endInset, (endInset) =>
                        change({ endInset }),
                      )}
                    </div>
                    <p className="field-help">
                      Indique início e fim separadamente no desenho. A direção
                      da faixa é independente da peça. L não é comprimento da
                      faixa; T não é passo entre grampos.
                    </p>
                  </>
                )}
                <p className="field-help">
                  Uma unidade é um grampo completo. Duas pernas e vistas
                  adicionais não multiplicam o aço. A repetição pertence ao
                  detalhamento.
                </p>
              </>
            )}
            {tab === 'Representação' && (
              <>
                <BeamClampViewFields
                  value={c.view}
                  onChange={(view) => change({ view })}
                />
                {(['dimensions', 'identification', 'hooks'] as const).map(
                  (key) => (
                    <label className="check" key={key}>
                      <input
                        type="checkbox"
                        checked={c.display[key]}
                        onChange={(e) =>
                          change({
                            display: { ...c.display, [key]: e.target.checked },
                            ...(key === 'hooks'
                              ? { view: { ...c.view, hooks: e.target.checked } }
                              : {}),
                          })
                        }
                      />
                      {
                        {
                          dimensions: 'Mostrar cotas reais',
                          identification: 'Mostrar identificação',
                          hooks: 'Mostrar ganchos na representação',
                        }[key]
                      }
                    </label>
                  ),
                )}
                <p className="field-help">
                  A perspectiva é esquemática. Compressão transversal, lado e
                  visibilidade mudam apenas a vista; L, T, corte e massa
                  permanecem físicos.
                </p>
              </>
            )}
          </div>
          <div className="stirrup-shape-preview beam-clamp-previews">
            {preview && (
              <>
                <ClampDiagram bar={preview} mode="development" />
                <ClampDiagram bar={preview} mode="perspective" />
                <small>
                  L = {format(c.profile.longitudinal, 2)} mm · T ={' '}
                  {format(c.profile.transverse, 2)} mm
                  <br />
                  Raio no eixo R = {format((c.mandrel + c.diameter) / 2, 3)} mm
                  <br />
                  Comprimento geométrico = {format(
                    geometry(preview).length,
                    4,
                  )}{' '}
                  mm
                  <br />
                  Ajuste de fabricação = 0 mm
                  <br />
                  <b>
                    Comprimento de corte = {format(geometry(preview).length, 4)}{' '}
                    mm
                  </b>
                </small>
              </>
            )}
            {!preview && (
              <p>Preencha medidas compatíveis para visualizar o grampo.</p>
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
            {editMark ? 'Aplicar alterações' : 'Posicionar grampo'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function BeamClampViewFields({
  value: v,
  onChange,
}: {
  value: BeamClampView;
  onChange: (view: BeamClampView) => void;
}) {
  return (
    <>
      <label className="field">
        Vista do grampo
        <select
          aria-label="Vista do grampo"
          value={v.mode}
          onChange={(e) =>
            onChange({ ...v, mode: e.target.value as BeamClampView['mode'] })
          }
        >
          <option value="perspective">Perspectiva esquemática</option>
          <option value="development">Desenvolvimento plano</option>
        </select>
      </label>
      {v.mode === 'perspective' && (
        <div className="fields-2">
          <label className="field">
            Fator transversal gráfico
            <input
              aria-label="Fator transversal gráfico"
              type="number"
              min="0.001"
              max="2"
              step="any"
              value={v.transverseScale}
              onChange={(e) =>
                onChange({ ...v, transverseScale: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            Ângulo transversal gráfico (°)
            <input
              aria-label="Ângulo transversal gráfico (°)"
              type="number"
              min="5"
              max="175"
              step="any"
              value={v.transverseAngle}
              onChange={(e) =>
                onChange({ ...v, transverseAngle: Number(e.target.value) })
              }
            />
          </label>
        </div>
      )}
      <label className="field">
        Lado fechado na vista
        <select
          aria-label="Lado fechado na vista"
          value={v.closedSide}
          onChange={(e) =>
            onChange({
              ...v,
              closedSide: e.target.value as BeamClampView['closedSide'],
            })
          }
        >
          <option value="left">Dobra à esquerda</option>
          <option value="right">Dobra à direita</option>
        </select>
      </label>
    </>
  );
}

function ClampDiagram({
  bar,
  mode,
}: {
  bar: Bar;
  mode: BeamClampView['mode'];
}) {
  const local = { ...bar, rotation: 0, origin: { x: 0, y: 0 } };
  const view = { ...bar.beamClampView!, mode };
  const points =
    mode === 'development'
      ? sampled(geometry(local).segments).map((p) =>
          beamClampViewPoint(p, view),
        )
      : beamClampViewPoints(local, view);
  const box = bounds(points),
    margin = Math.max(box.width, box.height, 100) * 0.2;
  const L = bar.beamClamp!.longitudinal,
    T = bar.beamClamp!.transverse;
  const project = (x: number, y: number) => {
    const p = beamClampViewPoint({ x, y }, view);
    return { x: p.x, y: -p.y };
  };
  const a = project(0, -T / 2),
    b = project(0, T / 2),
    c = project(L, T / 2),
    d = project(L, -T / 2);
  return (
    <figure>
      <figcaption>
        {mode === 'development'
          ? 'Forma real · desenvolvimento no eixo'
          : 'Perspectiva esquemática · cotas reais'}
      </figcaption>
      <svg
        role="img"
        aria-label={
          mode === 'development'
            ? 'Convenção L e T no eixo do grampo'
            : 'Prévia esquemática do grampo'
        }
        viewBox={`${box.x - 2 * margin} ${-box.y - box.height - margin} ${box.width + 3 * margin} ${box.height + 2 * margin}`}
      >
        <polyline
          points={[d, a, b, c].map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="5 5"
          vectorEffect="non-scaling-stroke"
          opacity=".45"
        />
        <polyline
          points={points.map((p) => `${p.x},${-p.y}`).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx="0" cy="0" r={margin * 0.07} fill="currentColor" />
        <text
          x={(b.x + c.x) / 2}
          y={Math.min(b.y, c.y) - margin * 0.3}
          textAnchor="middle"
          fill="currentColor"
          fontSize={margin * 0.2}
        >
          L = {format(L)} mm
        </text>
        <text
          x={(a.x + b.x) / 2 - margin * 0.3}
          y={(a.y + b.y) / 2}
          textAnchor="end"
          fill="currentColor"
          fontSize={margin * 0.2}
        >
          T = {format(T)} mm
        </text>
      </svg>
      <small>
        ● Inserção: meio do trecho transversal fechado. Pontas abertas{' '}
        {view.closedSide === 'left' ? 'à direita' : 'à esquerda'}.
      </small>
    </figure>
  );
}
