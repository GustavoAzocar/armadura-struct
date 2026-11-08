import { useEffect, useRef, useState } from 'react';
import type { Mask, Project } from '../domain/types';
import {
  nativePrimitive,
  newNativeMask,
  type NativeShape,
} from '../domain/nativeMasks';
export default function MaskControl({
  project,
  owner,
  initial,
  entity,
  onChange,
  onCreate,
  onSelect,
  onDelete,
  onClose,
}: {
  project: Project;
  owner: string;
  initial: string | null;
  entity?: string;
  onChange: (m: Mask) => void;
  onCreate: (m: Mask) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    [id, setId] = useState(initial ?? ''),
    [eid, setEid] = useState(entity ?? ''),
    [name, setName] = useState('Máscara de desenho'),
    [raw, setRaw] = useState(''),
    [error, setError] = useState(''),
    [dx, setDx] = useState(0),
    [dy, setDy] = useState(0),
    [angle, setAngle] = useState(0);
  const masks = project.masks.filter(
      (m) => project.hierarchy.objectDetails[m.id] === owner,
    ),
    m = masks.find((m) => m.id === id),
    e = m?.primitives.find((p) => p.id === eid);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const el = ref.current!;
    el.showModal();
    return () => {
      el.close();
      if (old?.isConnected) old.focus();
    };
  }, []);
  useEffect(() => {
    setRaw(e?.native ? JSON.stringify(e.native, null, 2) : '');
    setError('');
  }, [e]);
  const shape: NativeShape | undefined = raw ? JSON.parse(raw) : undefined;
  const pointFields = (
    points: { x: number; y: number }[],
    update: (v: { x: number; y: number }[]) => void,
  ) =>
    points.map((p, i) => (
      <div className="fields-2" key={i}>
        {(['x', 'y'] as const).map((axis) => (
          <label className="field" key={axis}>
            {`Ponto ${i + 1} ${axis.toUpperCase()} (mm)`}
            <input
              aria-label={`Ponto ${i + 1} ${axis.toUpperCase()}`}
              type="number"
              value={p[axis]}
              onChange={(ev) =>
                update(
                  points.map((q, j) =>
                    i === j ? { ...q, [axis]: Number(ev.target.value) } : q,
                  ),
                )
              }
            />
          </label>
        ))}
      </div>
    ));
  const run = (f: () => void) => {
    try {
      f();
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <dialog
      ref={ref}
      className="modal mask-control"
      aria-label="Controle de máscaras"
      onCancel={(ev) => {
        ev.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (
          (e.ctrlKey || e.metaKey) &&
          ['s', 'o'].includes(e.key.toLowerCase())
        )
          e.preventDefault();
      }}
    >
      <h2>Controle de máscaras</h2>
      <p>
        Detalhamento:{' '}
        {project.hierarchy.details.find((d) => d.id === owner)?.name}. Selecione
        uma entidade para editar somente sua geometria.
      </p>
      <label className="field">
        Máscara no detalhamento
        <select
          aria-label="Máscara no detalhamento"
          value={id}
          onChange={(ev) => {
            setId(ev.target.value);
            setEid('');
            onSelect(ev.target.value);
          }}
        >
          <option value="">Escolher máscara</option>
          {masks.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} · {m.format === 'NATIVE' ? 'Nativa' : m.format}
            </option>
          ))}
        </select>
      </label>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          run(() => {
            if (project.masks.length >= 20)
              throw new Error('Limite de 20 máscaras.');
            const next = newNativeMask(name);
            onCreate(next);
            setName('');
            setId(next.id);
            onSelect(next.id);
          });
        }}
      >
        <label className="field">
          Nome da nova máscara
          <input
            aria-label="Nome da nova máscara"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button>Criar máscara nativa</button>
      </form>
      {m && (
        <>
          <label className="field">
            Nome da máscara
            <input
              aria-label="Nome da máscara"
              value={m.name}
              onChange={(e) => {
                if (e.target.value.trim())
                  onChange({ ...m, name: e.target.value.slice(0, 200) });
              }}
            />
          </label>
          <p>
            {m.format === 'NATIVE'
              ? 'Desenho nativo em mm, sem aço.'
              : 'Referência importada; arquivo original preservado.'}
          </p>
          <button onClick={() => onChange({ ...m, visible: !m.visible })}>
            {m.visible ? 'Ocultar máscara' : 'Mostrar máscara'}
          </button>
          <button
            onClick={() => {
              onSelect(m.id);
              onClose();
            }}
          >
            Propriedades da máscara
          </button>
          <button
            onClick={() => {
              if (
                window.confirm(
                  `Excluir máscara “${m.name}” e suas entidades? Armaduras serão preservadas.`,
                )
              ) {
                onDelete(m.id);
                setId('');
                setEid('');
              }
            }}
          >
            Excluir máscara
          </button>
          {m.format === 'NATIVE' && (
            <>
              <label className="field">
                Entidade
                <select
                  aria-label="Entidade da máscara"
                  value={eid}
                  onChange={(ev) => setEid(ev.target.value)}
                >
                  <option value="">Selecionar entidade</option>
                  {m.primitives.map((p, i) => (
                    <option key={p.id} value={p.id}>
                      {i + 1} ·{' '}
                      {p.native
                        ? {
                            line: 'Linha',
                            rectangle: 'Retângulo',
                            circle: 'Círculo',
                            polyline: 'Polilinha',
                          }[p.native.kind]
                        : ''}{' '}
                      · {p.layer}
                    </option>
                  ))}
                </select>
              </label>
              {e && (
                <>
                  <p>
                    Geometria local em mm ·{' '}
                    {shape
                      ? {
                          line: 'Linha',
                          rectangle: 'Retângulo',
                          circle: 'Círculo',
                          polyline: 'Polilinha',
                        }[shape.kind]
                      : ''}
                  </p>
                  {shape?.kind === 'circle' ? (
                    <>
                      {pointFields([shape.center], (v) =>
                        setRaw(JSON.stringify({ ...shape, center: v[0] })),
                      )}
                      <label className="field">
                        Raio (mm)
                        <input
                          aria-label="Raio da entidade"
                          type="number"
                          value={shape.radius}
                          onChange={(ev) =>
                            setRaw(
                              JSON.stringify({
                                ...shape,
                                radius: Number(ev.target.value),
                              }),
                            )
                          }
                        />
                      </label>
                    </>
                  ) : (
                    shape && (
                      <>
                        {pointFields(shape.points, (v) =>
                          setRaw(JSON.stringify({ ...shape, points: v })),
                        )}
                        {shape.kind === 'polyline' && (
                          <>
                            <label>
                              <input
                                type="checkbox"
                                checked={shape.closed}
                                onChange={(ev) =>
                                  setRaw(
                                    JSON.stringify({
                                      ...shape,
                                      closed: ev.target.checked,
                                    }),
                                  )
                                }
                              />
                              Polilinha fechada
                            </label>
                            <button
                              onClick={() =>
                                setRaw(
                                  JSON.stringify({
                                    ...shape,
                                    points: [
                                      ...shape.points,
                                      {
                                        x: shape.points.at(-1)!.x + 100,
                                        y: shape.points.at(-1)!.y,
                                      },
                                    ],
                                  }),
                                )
                              }
                            >
                              Adicionar vértice
                            </button>
                            <button
                              disabled={shape.points.length <= 2}
                              onClick={() =>
                                setRaw(
                                  JSON.stringify({
                                    ...shape,
                                    points: shape.points.slice(0, -1),
                                  }),
                                )
                              }
                            >
                              Remover último vértice
                            </button>
                          </>
                        )}
                      </>
                    )
                  )}
                  <button
                    onClick={() =>
                      run(() => {
                        const s = JSON.parse(raw) as NativeShape;
                        const replacement = nativePrimitive(s, e.id, e.layer);
                        onChange({
                          ...m,
                          primitives: m.primitives.map((p) =>
                            p.id === e.id ? { ...p, ...replacement } : p,
                          ),
                        });
                      })
                    }
                  >
                    Aplicar geometria
                  </button>
                  <label className="field">
                    Layer nativo
                    <select
                      aria-label="Layer da entidade"
                      value={e.layerId ?? ''}
                      onChange={(ev) =>
                        onChange({
                          ...m,
                          primitives: m.primitives.map((p) =>
                            p.id === eid
                              ? { ...p, layerId: ev.target.value || undefined }
                              : p,
                          ),
                        })
                      }
                    >
                      <option value="">Herdar da máscara</option>
                      {project.layers.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="fields-2">
                    {[
                      ['Deslocamento X', dx, setDx],
                      ['Deslocamento Y', dy, setDy],
                      ['Ângulo em graus', angle, setAngle],
                    ].map(([label, value, set]) => (
                      <label className="field" key={String(label)}>
                        {String(label)}
                        <input
                          aria-label={String(label)}
                          type="number"
                          value={Number(value)}
                          onChange={(ev) =>
                            (set as (v: number) => void)(
                              Number(ev.target.value),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <p>
                    Transformação local: rotação em torno de (0, 0), seguida de
                    translação. Copiar cria apenas outra entidade gráfica.
                  </p>
                  {['Mover / girar entidade', 'Copiar entidade'].map(
                    (label, i) => (
                      <button
                        key={label}
                        onClick={() =>
                          run(() => {
                            if (
                              !e.native ||
                              ![dx, dy, angle].every(Number.isFinite)
                            )
                              throw new Error('Transformação inválida.');
                            const t = (angle * Math.PI) / 180;
                            const tr = (p: { x: number; y: number }) => ({
                              x: p.x * Math.cos(t) - p.y * Math.sin(t) + dx,
                              y: p.x * Math.sin(t) + p.y * Math.cos(t) + dy,
                            });
                            const s: NativeShape =
                              e.native.kind === 'circle'
                                ? { ...e.native, center: tr(e.native.center) }
                                : {
                                    kind: 'polyline',
                                    points: e.points.map(tr),
                                    closed: !!e.closed,
                                  };
                            const next = nativePrimitive(
                              s,
                              i ? undefined : e.id,
                              e.layer,
                            );
                            onChange({
                              ...m,
                              primitives: i
                                ? [...m.primitives, { ...e, ...next }]
                                : m.primitives.map((p) =>
                                    p.id === eid ? { ...p, ...next } : p,
                                  ),
                            });
                          })
                        }
                      >
                        {label}
                      </button>
                    ),
                  )}
                  <button
                    onClick={() => {
                      onChange({
                        ...m,
                        primitives: m.primitives.filter((p) => p.id !== eid),
                      });
                      setEid('');
                    }}
                  >
                    Excluir entidade
                  </button>
                </>
              )}
            </>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="modal-actions">
        <button onClick={onClose}>Concluir controle de máscaras</button>
      </div>
    </dialog>
  );
}
