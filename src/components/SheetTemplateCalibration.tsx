import { useMemo, useState } from 'react';
import { bounds } from '../domain/geometry';
import type { PaperPrimitive } from '../domain/paper';
import { calibrateSheetTemplateGeometry } from '../domain/sheetTemplates';
import type { Point } from '../domain/types';
import { DraftNumber, PointFields } from './SheetTemplateFields';
import SheetTemplatePreview from './SheetTemplatePreview';

export type ImportedTemplateGeometry = {
  fileName: string;
  sourceUnit: string;
  warnings: string[];
  geometry: PaperPrimitive[];
};

const units = { mm: 1, cm: 10, m: 1000 };
const number = (value: number) =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: 6 });

export default function SheetTemplateCalibration({
  source,
  paper,
  onApply,
  onCancel,
}: {
  source: ImportedTemplateGeometry;
  paper: { width: number; height: number };
  onApply: (geometry: PaperPrimitive[]) => void;
  onCancel: () => void;
}) {
  const limits = useMemo(
    () => bounds(source.geometry.flatMap((line) => line.points)),
    [source],
  );
  const unitKnown = source.sourceUnit !== 'não declarada';
  const [first, setFirst] = useState<Point>({ x: limits.x, y: limits.y });
  const [second, setSecond] = useState<Point>({
    x: limits.x + limits.width,
    y: limits.y + limits.height,
  });
  const [origin, setOrigin] = useState<Point>({ x: 0, y: 0 });
  const [desired, setDesired] = useState(NaN);
  const [unit, setUnit] = useState<keyof typeof units>('mm');
  const [pick, setPick] = useState<'first' | 'second'>();
  const [preview, setPreview] = useState<PaperPrimitive[]>();
  const [error, setError] = useState('');
  const current = Math.hypot(second.x - first.x, second.y - first.y);
  const distance = desired * units[unit];
  const factor = distance / current;
  const coordinateUnit = unitKnown ? 'mm' : 'unid.';
  const change = (action: () => void) => {
    action();
    setPreview(undefined);
    setError('');
  };
  const prepare = (useDeclaredDistance: boolean) => {
    try {
      const measuredDistance = useDeclaredDistance ? current : distance;
      const geometry = calibrateSheetTemplateGeometry(
        source.geometry,
        first,
        second,
        measuredDistance,
        origin,
      );
      if (useDeclaredDistance) {
        setUnit('mm');
        setDesired(current);
      }
      setPreview(geometry);
      setPick(undefined);
      setError('');
    } catch (cause) {
      setPreview(undefined);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível calibrar o desenho.',
      );
    }
  };
  return (
    <fieldset className="template-calibration">
      <legend>Calibrar desenho importado</legend>
      <p>
        <strong>{source.fileName}</strong> · {source.geometry.length} entidades
        · unidade {source.sourceUnit}
      </p>
      <p className="template-hint">
        Limites na origem: X {number(limits.x)} · Y {number(limits.y)} ·{' '}
        {number(limits.width)} × {number(limits.height)} {coordinateUnit}.
      </p>
      {!unitKnown && (
        <p className="template-alert">
          Informe uma distância conhecida e a unidade para confirmar a escala
          deste desenho.
        </p>
      )}
      {!!source.warnings.length && (
        <details open>
          <summary>Avisos da leitura CAD ({source.warnings.length})</summary>
          <ul>
            {source.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="template-buttons">
        <button
          type="button"
          aria-pressed={pick === 'first'}
          onClick={() => change(() => setPick('first'))}
        >
          Marcar ponto 1
        </button>
        <button
          type="button"
          aria-pressed={pick === 'second'}
          onClick={() => change(() => setPick('second'))}
        >
          Marcar ponto 2
        </button>
      </div>
      {pick && (
        <p role="status">
          Clique perto de um vértice do desenho para marcar o ponto{' '}
          {pick === 'first' ? '1' : '2'}.
        </p>
      )}
      <SheetTemplatePreview
        label="Desenho original para calibração"
        lines={source.geometry}
        points={[first, second]}
        snapToVertex
        onPick={
          pick
            ? (point) =>
                change(() => {
                  if (pick === 'first') setFirst(point);
                  else setSecond(point);
                  setPick(undefined);
                })
            : undefined
        }
      />
      <PointFields
        label="Ponto 1 do desenho"
        value={first}
        unit={coordinateUnit}
        onChange={(point) => change(() => setFirst(point))}
      />
      <PointFields
        label="Ponto 2 do desenho"
        value={second}
        unit={coordinateUnit}
        onChange={(point) => change(() => setSecond(point))}
      />
      <PointFields
        label="Posição do ponto 1 no papel"
        value={origin}
        onChange={(point) => change(() => setOrigin(point))}
      />
      <div className="template-fields">
        <DraftNumber
          label="Distância conhecida"
          value={desired}
          unit=""
          onChange={(value) => change(() => setDesired(value))}
        />
        <label className="template-field">
          <span>Unidade da distância</span>
          <select
            value={unit}
            onChange={(event) =>
              change(() => setUnit(event.target.value as keyof typeof units))
            }
          >
            {Object.keys(units).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="template-hint">
        Distância atual{' '}
        {Number.isFinite(current)
          ? `${number(current)} ${coordinateUnit}`
          : '—'}{' '}
        · desejada {Number.isFinite(distance) ? `${number(distance)} mm` : '—'}{' '}
        · fator {Number.isFinite(factor) ? number(factor) : '—'}.
      </p>
      {error && (
        <p role="alert" className="template-alert">
          {error}
        </p>
      )}
      <div className="template-buttons">
        {unitKnown && (
          <button type="button" onClick={() => prepare(true)}>
            Conferir unidade declarada em 1:1
          </button>
        )}
        <button type="button" onClick={() => prepare(false)}>
          Prévia calibrada
        </button>
        <button type="button" onClick={onCancel}>
          Cancelar importação CAD
        </button>
      </div>
      {preview && (
        <>
          <SheetTemplatePreview
            label="Desenho calibrado em milímetros de papel"
            lines={preview}
            size={paper}
          />
          <button
            type="button"
            className="primary"
            onClick={() => onApply(preview)}
          >
            Usar desenho calibrado
          </button>
        </>
      )}
    </fieldset>
  );
}
