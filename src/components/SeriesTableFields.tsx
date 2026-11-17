import type { Project, Sheet } from '../domain/types';
import type { SeriesTable } from '../domain/barSeriesSchema';
import { setSeriesTable } from '../domain/barSeries';
import { NumberField } from './Panels';

/**
 * Configuração das tabelas de comprimentos da folha. Toda alteração é de
 * apresentação: geometria e quantitativos continuam vindo das armaduras.
 */
export default function SeriesTableFields({
  project: p,
  sheet,
  selected,
  onSelect,
  onChange,
}: {
  project: Project;
  sheet: Sheet;
  selected?: string;
  onSelect: (id?: string) => void;
  onChange: (change: (p: Project) => Project) => boolean;
}) {
  const tables = sheet.seriesTables ?? [];
  if (!tables.length) return null;
  const update = (t: SeriesTable, patch: Partial<SeriesTable>) =>
    onChange((q) => setSeriesTable(q, sheet.id, t.id, { ...t, ...patch }));
  return (
    <fieldset className="sheet-properties">
      <legend>Tabelas de comprimentos (séries variáveis)</legend>
      {tables.map((t) => {
        const series = (p.barSeries ?? []).find((s) => s.id === t.seriesId);
        return (
          <details
            key={t.id}
            open={selected === t.id}
            onToggle={(e) => {
              if ((e.currentTarget as HTMLDetailsElement).open) onSelect(t.id);
            }}
            data-testid="series-table-fields"
          >
            <summary>
              Série {series?.name ?? '(ausente)'}
              {t.rowsPerBlock ? ` · ${t.rowsPerBlock} linhas/bloco` : ''}
            </summary>
            <label className="transfer-checkbox">
              <input
                type="checkbox"
                checked={t.visible !== false}
                onChange={(e) => update(t, { visible: e.target.checked })}
              />
              Mostrar tabela da série {series?.name}
            </label>
            <NumberField
              label="Tabela X"
              value={t.origin.x}
              suffix="mm"
              onChange={(x) => update(t, { origin: { ...t.origin, x } })}
            />
            <NumberField
              label="Tabela Y"
              value={t.origin.y}
              suffix="mm"
              onChange={(y) => update(t, { origin: { ...t.origin, y } })}
            />
            <NumberField
              label="Texto da tabela"
              value={t.textHeight}
              min={1.8}
              max={5}
              suffix="mm"
              onChange={(textHeight) => update(t, { textHeight })}
            />
            <NumberField
              label="Linhas por bloco (0 = único)"
              value={t.rowsPerBlock ?? 0}
              min={0}
              max={1000}
              step={1}
              onChange={(n) => {
                const rows = Math.round(n);
                const next: SeriesTable = { ...t };
                if (rows > 0) next.rowsPerBlock = rows;
                else delete next.rowsPerBlock;
                // Nova divisão: continuações voltam à disposição automática.
                delete next.blockOrigins;
                return onChange((q) => setSeriesTable(q, sheet.id, t.id, next));
              }}
            />
            <label className="field">
              <span>Linhas</span>
              <select
                aria-label="Agrupamento da tabela na folha"
                value={t.grouping}
                onChange={(e) =>
                  update(t, {
                    grouping: e.target.value as SeriesTable['grouping'],
                  })
                }
              >
                <option value="variant">Uma linha por variante</option>
                <option value="fabrication">Agrupar equivalentes</option>
              </select>
            </label>
            {(
              [
                ['dimensions', 'Cotas'],
                ['formula', 'Fórmula'],
                ['developed', 'C. desenvolvido'],
                ['mass', 'Peso'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="transfer-checkbox">
                <input
                  type="checkbox"
                  checked={t.columns[key]}
                  onChange={(e) =>
                    update(t, {
                      columns: { ...t.columns, [key]: e.target.checked },
                    })
                  }
                />
                {label}
              </label>
            ))}
            {t.blockOrigins?.length ? (
              <button onClick={() => update(t, { blockOrigins: undefined })}>
                Reorganizar continuações automaticamente
              </button>
            ) : null}
            <button
              onClick={() =>
                onChange((q) => setSeriesTable(q, sheet.id, t.id, undefined))
              }
            >
              Retirar tabela da folha
            </button>
            <p className="field-help">
              Retirar, mover ou dividir a tabela não altera aço. Arraste cada
              bloco no papel para posicioná-lo.
            </p>
          </details>
        );
      })}
    </fieldset>
  );
}

/** Painel durante a prévia de inserção: destino e apresentação, sem gravar. */
export function SeriesPlacementPanel({
  project,
  value,
  onSheet,
  onChange,
  onCancel,
}: {
  project: Project;
  value: {
    sheetId: string;
    seriesId: string;
    options: Pick<
      SeriesTable,
      'grouping' | 'columns' | 'rowsPerBlock' | 'textHeight'
    >;
  };
  onSheet: (id: string) => void;
  onChange: (options: {
    grouping: SeriesTable['grouping'];
    columns: SeriesTable['columns'];
    rowsPerBlock?: number;
    textHeight: number;
  }) => void;
  onCancel: () => void;
}) {
  const series = (project.barSeries ?? []).find((s) => s.id === value.seriesId);
  const existing = project.sheets
    .find((s) => s.id === value.sheetId)
    ?.seriesTables?.some((t) => t.seriesId === value.seriesId);
  return (
    <section
      className="transform-panel"
      aria-label="Inserir tabela de comprimentos"
    >
      <div className="transform-heading">
        <b>Tabela da série {series?.name}</b>
        <span>Papel · mm</span>
      </div>
      <label className="field">
        <span>Prancha de destino</span>
        <select
          aria-label="Prancha da tabela"
          value={value.sheetId}
          onChange={(e) => onSheet(e.target.value)}
        >
          {project.sheets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <NumberField
        label="Altura do texto da tabela"
        value={value.options.textHeight}
        min={1.8}
        max={5}
        suffix="mm"
        onChange={(textHeight) => onChange({ ...value.options, textHeight })}
      />
      <NumberField
        label="Linhas por bloco (0 = único)"
        value={value.options.rowsPerBlock ?? 0}
        min={0}
        max={1000}
        step={1}
        onChange={(n) =>
          onChange({
            ...value.options,
            rowsPerBlock: n > 0 ? Math.round(n) : undefined,
          })
        }
      />
      <p>
        Escopo: série {series?.name} · somente as variantes documentadas nesta
        folha. Clique para inserir pelo canto superior esquerdo; as continuações
        ficam à direita e podem ser arrastadas.
      </p>
      {existing && (
        <p>Esta folha já tem a tabela desta série. O clique a reposiciona.</p>
      )}
      <button onClick={onCancel}>Cancelar inserção da tabela</button>
    </section>
  );
}
