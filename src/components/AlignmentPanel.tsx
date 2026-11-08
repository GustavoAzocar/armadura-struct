import type { Project } from '../domain/types';
import type { AlignmentItem, AlignmentOptions } from '../domain/alignment';
import { NumberField } from './Panels';
export type AlignmentSession = {
  project: Project;
  ids: string[];
  options: AlignmentOptions;
  sheetId?: string;
  picking?: 'start' | 'end';
};
export default function AlignmentPanel({
  value: s,
  items,
  onChange,
  onApply,
  onCancel,
  error,
}: {
  value: AlignmentSession;
  items: AlignmentItem[];
  onChange: (s: AlignmentSession) => void;
  onApply: () => void;
  onCancel: () => void;
  error?: string;
}) {
  const set = (patch: Partial<AlignmentOptions>) =>
    onChange({ ...s, options: { ...s.options, ...patch } });
  const ref = s.options.reference ?? {
    start: { x: 0, y: 0 },
    end: { x: 1000, y: 0 },
  };
  return (
    <section
      className="transform-panel"
      aria-label="Alinhamento da seleção"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="transform-heading">
        <b>Alinhar / distribuir</b>
        <span>{s.sheetId ? 'Papel · mm' : 'Modelo · mm'} · prévia</span>
      </div>
      <label className="field">
        <span>Operação</span>
        <select
          aria-label="Operação de alinhamento"
          value={s.options.mode}
          onChange={(e) =>
            set({ mode: e.target.value as AlignmentOptions['mode'] })
          }
        >
          <option value="align">Alinhar</option>
          <option value="distribute">Afastamento uniforme</option>
        </select>
      </label>
      <label className="field">
        <span>Direção</span>
        <select
          aria-label="Direção de alinhamento"
          value={s.options.axis}
          onChange={(e) =>
            set({
              axis: e.target.value as AlignmentOptions['axis'],
              reference: ref,
            })
          }
        >
          <option value="x">Horizontal · X</option>
          <option value="y">Vertical · Y</option>
          <option value="reference">Linha de referência</option>
        </select>
      </label>
      <label className="field">
        <span>Conjunto fixo</span>
        <select
          aria-label="Conjunto fixo"
          value={s.options.fixedId}
          onChange={(e) => set({ fixedId: e.target.value })}
        >
          {items.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      {s.options.mode === 'align' ? (
        <label className="field">
          <span>Âncora da caixa</span>
          <select
            aria-label="Âncora de alinhamento"
            value={s.options.anchor}
            onChange={(e) =>
              set({ anchor: e.target.value as AlignmentOptions['anchor'] })
            }
          >
            <option value="min">Borda mínima (esquerda / inferior)</option>
            <option value="center">Centro</option>
            <option value="max">Borda máxima (direita / superior)</option>
          </select>
        </label>
      ) : (
        <NumberField
          label="Afastamento entre caixas"
          value={s.options.gap}
          min={0}
          suffix="mm"
          onChange={(gap) => set({ gap })}
        />
      )}
      {s.options.axis === 'reference' && (
        <>
          <p>
            {s.picking
              ? `Clique no ${s.picking === 'start' ? 'primeiro' : 'segundo'} ponto da referência.`
              : 'A linha define o alinhamento; na distribuição, define a direção. O conjunto fixo permanece no lugar.'}
          </p>
          <div className="fields-2">
            {(['start', 'end'] as const).map((end) => (
              <div key={end}>
                {(['x', 'y'] as const).map((axis) => (
                  <NumberField
                    key={axis}
                    label={`${end === 'start' ? 'Referência inicial' : 'Referência final'} ${axis.toUpperCase()}`}
                    value={ref[end][axis]}
                    onChange={(n) =>
                      set({
                        reference: {
                          ...ref,
                          [end]: { ...ref[end], [axis]: n },
                        },
                      })
                    }
                  />
                ))}
              </div>
            ))}
          </div>
          <button
            onClick={() =>
              onChange({
                ...s,
                picking: 'start',
                options: { ...s.options, reference: ref },
              })
            }
          >
            Escolher referência por pontos
          </button>
        </>
      )}
      {s.sheetId && (
        <details>
          <summary>Vistas participantes</summary>
          {items.map((v) => (
            <label className="alignment-view-choice" key={v.id}>
              <input
                type="checkbox"
                aria-label={`Alinhar ${v.label}`}
                checked={s.ids.includes(v.id)}
                onChange={(e) =>
                  onChange({
                    ...s,
                    ids: e.target.checked
                      ? [...s.ids, v.id]
                      : s.ids.filter((id) => id !== v.id),
                  })
                }
              />
              {v.label}
            </label>
          ))}
        </details>
      )}
      <p>
        Caixas incluem textos. Cada conjunto move uma vez, sem deformar a
        geometria. Esc / Desfazer cancela.
      </p>
      {error && <p role="status">{error}</p>}
      <div className="visibility-actions">
        <button className="primary" disabled={!!error} onClick={onApply}>
          Aplicar alinhamento
        </button>
        <button onClick={onCancel}>Cancelar alinhamento</button>
      </div>
    </section>
  );
}
