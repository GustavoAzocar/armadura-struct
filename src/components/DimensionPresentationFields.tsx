import { useState } from 'react';
import {
  dimensionMultipleText,
  dimensionPresentationSchema,
  dimensionRoundingModes,
  formatDimension,
  formatDimensionCaption,
  readDimensionMultiple,
  type DimensionPresentation,
} from '../domain/dimensionPresentation';

type Mode = keyof typeof dimensionRoundingModes;
type Draft = {
  unit: DimensionPresentation['unit'];
  precision: number;
  enabled: boolean;
  multiple: string;
  mode: Mode;
};

function editPresentation(options: DimensionPresentation): Draft {
  return {
    unit: options.unit,
    precision: options.precision,
    enabled: !!options.rounding,
    multiple: dimensionMultipleText({
      ...options,
      rounding: options.rounding ?? {
        multipleTicks: 5_000_000,
        mode: 'nearest',
      },
    }),
    mode: options.rounding?.mode ?? 'nearest',
  };
}

function parseDraft(draft: Draft) {
  const multipleTicks = readDimensionMultiple(draft.multiple, draft.unit);
  const result = dimensionPresentationSchema.safeParse({
    unit: draft.unit,
    precision: draft.precision,
    ...(draft.enabled && multipleTicks
      ? { rounding: { multipleTicks, mode: draft.mode } }
      : {}),
  });
  const error =
    draft.enabled && !multipleTicks
      ? 'Informe um múltiplo positivo entre 0,000001 e 1.000.000.000 mm, com até 6 casas em mm.'
      : result.error?.issues[0]?.message;
  return { multipleTicks, result, error };
}

export default function DimensionPresentationFields({
  presentation,
  onPresentation,
  onEditing,
  measurement,
  manualLabel,
  context,
}: {
  presentation: DimensionPresentation;
  onPresentation: (options: DimensionPresentation) => void;
  onEditing?: (editing: boolean, preview?: DimensionPresentation) => void;
  measurement?: number;
  manualLabel?: string;
  context: 'medida' | 'cota';
}) {
  const [draft, setDraft] = useState<Draft>();
  const current = draft ?? editPresentation(presentation);
  const { multipleTicks, result, error } = parseDraft(current);
  const update = (patch: Partial<Draft>) => {
    const next = { ...current, ...patch };
    const preview = parseDraft(next);
    setDraft(next);
    onEditing?.(true, preview.error ? undefined : preview.result.data);
  };
  const finish = () => {
    setDraft(undefined);
    onEditing?.(false);
  };
  const changeUnit = (unit: Draft['unit']) => {
    if (unit === current.unit) return;
    if (!draft && !current.enabled) {
      onPresentation({ ...presentation, unit });
      return;
    }
    if (current.enabled && !multipleTicks) return;
    update({
      unit,
      multiple: dimensionMultipleText({
        unit,
        precision: current.precision,
        rounding: {
          multipleTicks: multipleTicks ?? 5_000_000,
          mode: current.mode,
        },
      }),
    });
  };
  return (
    <div>
      <div className="field-row">
        <label className="field">
          Unidade
          <select
            aria-label={`Unidade da ${context}`}
            value={current.unit}
            disabled={current.enabled && !multipleTicks}
            onChange={(e) => changeUnit(e.target.value as Draft['unit'])}
          >
            {['mm', 'cm', 'm'].map((unit) => (
              <option key={unit}>{unit}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Casas decimais
          <select
            aria-label={`Precisão da ${context}`}
            value={current.precision}
            onChange={(e) => {
              const precision = Number(e.target.value);
              if (draft || current.enabled) update({ precision });
              else onPresentation({ ...presentation, precision });
            }}
          >
            {[0, 1, 2, 3, 4, 5, 6].map((precision) => (
              <option key={precision}>{precision}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        <input
          type="checkbox"
          checked={current.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
        />{' '}
        Arredondar cota por múltiplo
      </label>
      {current.enabled && (
        <div className="field-row">
          <label className="field">
            Múltiplo ({current.unit})
            <input
              inputMode="decimal"
              value={current.multiple}
              maxLength={32}
              onChange={(e) => update({ multiple: e.target.value })}
            />
          </label>
          <label className="field">
            Modo de arredondamento
            <select
              value={current.mode}
              onChange={(e) => update({ mode: e.target.value as Mode })}
            >
              {Object.entries(dimensionRoundingModes).map(([mode, label]) => (
                <option key={mode} value={mode}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {measurement !== undefined && result.success && !error && (
        <p role="status">
          Modelo: {measurement.toString().replace('.', ',')} mm. Sem múltiplo:{' '}
          {formatDimension(measurement, result.data)}. Exibido:{' '}
          {manualLabel || formatDimensionCaption(measurement, result.data)}
          {manualLabel ? ' (texto manual)' : ''}.
        </p>
      )}
      {draft && (
        <div className="field-row">
          <button
            type="button"
            disabled={!!error}
            onClick={() => {
              if (!result.success || error) return;
              if (JSON.stringify(result.data) !== JSON.stringify(presentation))
                onPresentation(result.data);
              finish();
            }}
          >
            Aplicar apresentação
          </button>
          <button type="button" onClick={finish}>
            Cancelar edição da apresentação
          </button>
        </div>
      )}
    </div>
  );
}
