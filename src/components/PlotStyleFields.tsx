import type { DrawingStyle, PlotStyle } from '../domain/types';
import { PLOT_LINE_TYPES } from '../domain/plotting';
import { NumberField } from './Panels';

/** Emits only touched properties so bulk layer edits preserve other overrides. */
export default function PlotStyleFields({
  value = {},
  base,
  onChange,
  onReset,
}: {
  value?: PlotStyle;
  base: DrawingStyle;
  onChange: (patch: PlotStyle) => void;
  onReset: () => void;
}) {
  return (
    <details className="plot-fields">
      <summary>Estilo de impressão</summary>
      <p className="field-help">
        A tela mantém seu estilo. Penas e traços abaixo usam mm no papel. Os
        presets são aplicados sobre estas cores.
      </p>
      <label className="field">
        <span>Saída</span>
        <select
          aria-label="Inclusão na impressão"
          value={value.include === undefined ? '' : String(value.include)}
          onChange={(e) =>
            onChange({
              include:
                e.target.value === '' ? undefined : e.target.value === 'true',
            })
          }
        >
          <option value="">Herdar</option>
          <option value="true">Incluir</option>
          <option value="false">Não imprimir</option>
        </select>
      </label>
      {(['color', 'fillColor'] as const).map((key) => {
        const label =
          key === 'color'
            ? 'Cor de impressão'
            : 'Cor de preenchimento na impressão';
        return (
          <div key={key} className="fields-2">
            <label className="field">
              <span>{label}</span>
              <select
                aria-label={`${label} · herança`}
                value={value[key] ? 'own' : ''}
                onChange={(e) =>
                  onChange({ [key]: e.target.value ? base[key] : undefined })
                }
              >
                <option value="">Herdar</option>
                <option value="own">Definir</option>
              </select>
            </label>
            {value[key] && (
              <input
                type="color"
                aria-label={label}
                value={value[key]}
                onChange={(e) => onChange({ [key]: e.target.value })}
              />
            )}
          </div>
        );
      })}
      <label className="field">
        <span>Pena no papel</span>
        <select
          aria-label="Espessura de impressão · herança"
          value={value.lineWidth === undefined ? '' : 'own'}
          onChange={(e) =>
            onChange({ lineWidth: e.target.value ? base.lineWidth : undefined })
          }
        >
          <option value="">Herdar</option>
          <option value="own">Definir</option>
        </select>
      </label>
      {value.lineWidth !== undefined && (
        <NumberField
          label="Espessura de impressão"
          value={value.lineWidth}
          min={0}
          max={2.11}
          suffix="mm"
          onChange={(lineWidth) => onChange({ lineWidth })}
        />
      )}
      <label className="field">
        <span>Linha no papel</span>
        <select
          aria-label="Linha de impressão"
          value={value.lineType ? JSON.stringify(value.lineType) : ''}
          onChange={(e) =>
            onChange({
              lineType: e.target.value ? JSON.parse(e.target.value) : undefined,
            })
          }
        >
          <option value="">Herdar</option>
          {value.lineType &&
            !PLOT_LINE_TYPES.some(
              (t) => JSON.stringify(t) === JSON.stringify(value.lineType),
            ) && (
              <option value={JSON.stringify(value.lineType)}>
                {value.lineType.name}
              </option>
            )}
          {PLOT_LINE_TYPES.map((t) => (
            <option key={t.name} value={JSON.stringify(t)}>
              {t.name === 'CONTINUOUS'
                ? 'Contínua'
                : t.name === 'DASHED'
                  ? 'Tracejada · 2 / 1 mm'
                  : t.name === 'DOTTED'
                    ? 'Pontilhada'
                    : 'Traço e ponto'}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Escala do traço</span>
        <select
          aria-label="Escala de impressão · herança"
          value={value.lineScale === undefined ? '' : 'own'}
          onChange={(e) =>
            onChange({ lineScale: e.target.value ? base.lineScale : undefined })
          }
        >
          <option value="">Herdar</option>
          <option value="own">Definir</option>
        </select>
      </label>
      {value.lineScale !== undefined && (
        <NumberField
          label="Escala do traço de impressão"
          value={value.lineScale}
          min={0.000001}
          max={10000}
          onChange={(lineScale) => onChange({ lineScale })}
        />
      )}
      <button onClick={onReset}>Restaurar herança de impressão</button>
    </details>
  );
}
