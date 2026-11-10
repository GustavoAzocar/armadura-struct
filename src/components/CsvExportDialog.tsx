import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../domain/types';
import {
  detailOptions,
  sheetOptions,
  type ScopeSelection,
} from '../domain/scheduleScopes';
import {
  defaultCsvExportOptions,
  lengthDigits,
  planScopedCsv,
  type CsvExportOptions,
} from '../lib/scopedCsv';

type ScopeChoice = 'project' | 'sheets' | 'details';
const kg = (n: number) =>
  n.toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

/** Configuração temporária: nada aqui é gravado no projeto ou no histórico. */
export default function CsvExportDialog({
  project: p,
  activeSheetId,
  onExport,
  onClose,
}: {
  project: Project;
  activeSheetId?: string;
  onExport: (
    selection: ScopeSelection,
    options: CsvExportOptions,
  ) => Promise<boolean | string>;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    const element = modal.current;
    element?.showModal();
    close.current?.focus();
    return () => {
      element?.close();
      old?.focus();
    };
  }, []);
  const [scope, setScope] = useState<ScopeChoice>(
    activeSheetId ? 'sheets' : 'project',
  );
  const [sheetMode, setSheetMode] = useState<'active' | 'selected' | 'all'>(
    activeSheetId ? 'active' : 'selected',
  );
  const [sheetIds, setSheetIds] = useState<string[]>([]);
  const [detailMode, setDetailMode] = useState<'selected' | 'all'>('selected');
  const [detailIds, setDetailIds] = useState<string[]>([]);
  const [o, setO] = useState<CsvExportOptions>(defaultCsvExportOptions);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  const sheets = useMemo(() => sheetOptions(p), [p]);
  const details = useMemo(() => detailOptions(p), [p]);
  const selection: ScopeSelection =
    scope === 'project'
      ? { kind: 'project' }
      : scope === 'sheets'
        ? { kind: 'sheets', mode: sheetMode, sheetIds }
        : { kind: 'details', mode: detailMode, detailIds };
  const plan = useMemo(
    () => planScopedCsv(p, selection, o, activeSheetId),
    // A seleção é recriada a cada render; a chave textual estabiliza a prévia.
    [p, JSON.stringify(selection), o, activeSheetId],
  );
  const active = sheets.find((s) => s.id === activeSheetId);
  const many = plan.scopes.filter((s) => s.kind !== 'physical-total').length;
  const set = (patch: Partial<CsvExportOptions>) =>
    setO((old) => ({ ...old, ...patch }));
  const toggle = (list: string[], id: string, on: boolean) =>
    on ? [...list, id] : list.filter((v) => v !== id);
  const percent = o.allowance.mode === 'none' ? 0 : o.allowance.percent;
  const unit = (u: 'cm' | 'm') =>
    `${u} (${lengthDigits(u, o.precision)} casa${lengthDigits(u, o.precision) > 1 ? 's' : ''})`;
  return (
    <dialog
      ref={modal}
      className="modal detail-transfer-modal csv-export"
      role="dialog"
      aria-modal="true"
      aria-labelledby="csv-export-title"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (
          (e.ctrlKey || e.metaKey) &&
          ['s', 'o', 'z', 'y'].includes(e.key.toLowerCase())
        )
          e.preventDefault();
      }}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <button
        ref={close}
        className="modal-close"
        aria-label="Fechar exportação CSV"
        disabled={busy}
        onClick={onClose}
      >
        ×
      </button>
      <h2 id="csv-export-title">Exportar relação do aço (CSV)</h2>
      <p className="field-help">
        Configuração somente desta exportação. O projeto, as pranchas e a
        relação de aço não são alterados. <b>Quadro CSV</b> continua exportando
        o quadro global com as colunas anteriores.
      </p>
      <div className="csv-export-grid">
        <fieldset disabled={busy}>
          <legend>Escopo</legend>
          <label>
            <input
              type="radio"
              name="csv-scope"
              checked={scope === 'project'}
              onChange={() => setScope('project')}
            />
            Projeto completo
          </label>
          <label>
            <input
              type="radio"
              name="csv-scope"
              checked={scope === 'sheets'}
              onChange={() => setScope('sheets')}
            />
            Pranchas
          </label>
          <label>
            <input
              type="radio"
              name="csv-scope"
              checked={scope === 'details'}
              onChange={() => setScope('details')}
            />
            Elementos (detalhamentos)
          </label>
          {scope === 'sheets' && (
            <div className="csv-export-choices" aria-label="Pranchas">
              <label>
                <input
                  type="radio"
                  name="csv-sheets"
                  disabled={!active}
                  checked={sheetMode === 'active'}
                  onChange={() => setSheetMode('active')}
                />
                Prancha ativa
                {active ? `: ${active.label}` : ' (nenhuma aberta)'}
              </label>
              <label>
                <input
                  type="radio"
                  name="csv-sheets"
                  checked={sheetMode === 'selected'}
                  onChange={() => setSheetMode('selected')}
                />
                Pranchas selecionadas
              </label>
              <label>
                <input
                  type="radio"
                  name="csv-sheets"
                  checked={sheetMode === 'all'}
                  onChange={() => setSheetMode('all')}
                />
                Todas as pranchas ({sheets.length})
              </label>
              {sheetMode === 'selected' && (
                <div className="csv-export-list">
                  {sheets.map((s) => (
                    <label key={s.id}>
                      <input
                        type="checkbox"
                        checked={sheetIds.includes(s.id)}
                        onChange={(e) =>
                          setSheetIds((l) => toggle(l, s.id, e.target.checked))
                        }
                      />
                      {s.label}
                      <small>
                        {s.barCount
                          ? `${s.barCount} armadura(s)`
                          : 'sem armaduras'}
                      </small>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {scope === 'details' && (
            <div className="csv-export-choices" aria-label="Elementos">
              <label>
                <input
                  type="radio"
                  name="csv-details"
                  checked={detailMode === 'selected'}
                  onChange={() => setDetailMode('selected')}
                />
                Elementos selecionados
              </label>
              <label>
                <input
                  type="radio"
                  name="csv-details"
                  checked={detailMode === 'all'}
                  onChange={() => setDetailMode('all')}
                />
                Todos os elementos ({details.length})
              </label>
              {detailMode === 'selected' && (
                <div className="csv-export-list">
                  {details.map((d) => (
                    <label key={d.id}>
                      <input
                        type="checkbox"
                        checked={detailIds.includes(d.id)}
                        onChange={(e) =>
                          setDetailIds((l) => toggle(l, d.id, e.target.checked))
                        }
                      />
                      {d.label}
                      <small>
                        {d.repetition ? `${d.repetition} · ` : ''}
                        {d.barCount
                          ? `${d.barCount} armadura(s)`
                          : 'sem armaduras'}
                      </small>
                    </label>
                  ))}
                </div>
              )}
              <p className="field-help">
                Vínculo: armaduras pertencentes ao detalhamento. Detalhamentos
                repetidos saem como conjunto, sem rateio por elemento.
              </p>
            </div>
          )}
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Conteúdo e arquivos</legend>
          <label>
            <input
              type="checkbox"
              checked={o.detailed}
              onChange={(e) => set({ detailed: e.target.checked })}
            />
            Quadro detalhado
          </label>
          <label>
            <input
              type="checkbox"
              checked={o.summary}
              onChange={(e) => set({ summary: e.target.checked })}
            />
            Resumo do aço
          </label>
          <label className="field">
            <span>Vários escopos</span>
            <select
              aria-label="Organização dos arquivos"
              value={o.layout}
              onChange={(e) =>
                set({ layout: e.target.value as CsvExportOptions['layout'] })
              }
            >
              <option value="separate">Arquivos separados por escopo</option>
              <option value="consolidated">
                Consolidado com colunas de escopo
              </option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={o.physicalTotal}
              onChange={(e) => set({ physicalTotal: e.target.checked })}
            />
            Incluir total físico (união dos IDs)
          </label>
          <div className="transfer-fields">
            <label className="field">
              <span>Comprimentos do quadro</span>
              <select
                aria-label="Unidade do quadro detalhado"
                value={o.detailedLength}
                onChange={(e) =>
                  set({ detailedLength: e.target.value as 'cm' | 'm' })
                }
              >
                <option value="cm">cm</option>
                <option value="m">m</option>
              </select>
            </label>
            <label className="field">
              <span>Comprimentos do resumo</span>
              <select
                aria-label="Unidade do resumo"
                value={o.summaryLength}
                onChange={(e) =>
                  set({ summaryLength: e.target.value as 'cm' | 'm' })
                }
              >
                <option value="m">m</option>
                <option value="cm">cm</option>
              </select>
            </label>
            <label className="field">
              <span>Arredondamento</span>
              <select
                aria-label="Arredondamento"
                value={o.precision}
                onChange={(e) =>
                  set({
                    precision: e.target.value as CsvExportOptions['precision'],
                  })
                }
              >
                <option value="sheet">Como no quadro</option>
                <option value="extended">Ampliado</option>
              </select>
            </label>
            <label className="field">
              <span>Decimal</span>
              <select
                aria-label="Separador decimal"
                value={o.decimal}
                onChange={(e) => set({ decimal: e.target.value as ',' | '.' })}
              >
                <option value=",">Vírgula</option>
                <option value=".">Ponto</option>
              </select>
            </label>
          </div>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Acréscimo no peso</legend>
          <label className="field">
            <span>Política</span>
            <select
              aria-label="Política de acréscimo"
              value={o.allowance.mode}
              onChange={(e) => {
                const mode = e.target.value as typeof o.allowance.mode;
                set({
                  allowance:
                    mode === 'none' ? { mode } : { mode, percent: percent },
                });
              }}
            >
              <option value="scope">Do quadro de cada prancha</option>
              <option value="override">Mesmo valor para todos</option>
              <option value="none">Sem acréscimo</option>
            </select>
          </label>
          {o.allowance.mode !== 'none' && (
            <label className="field">
              <span>
                {o.allowance.mode === 'scope'
                  ? 'Escopos sem quadro inserido (%)'
                  : 'Acréscimo desta exportação (%)'}
              </span>
              <input
                aria-label="Percentual de acréscimo"
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={percent}
                onChange={(e) =>
                  set({
                    allowance: {
                      mode: o.allowance.mode as 'scope' | 'override',
                      percent: e.target.valueAsNumber,
                    },
                  })
                }
              />
            </label>
          )}
          <p className="field-help">
            O acréscimo afeta somente a coluna de peso com acréscimo. Peso
            teórico, quantidades e comprimentos não mudam, e a prancha não é
            alterada.
          </p>
        </fieldset>
      </div>
      <h3>Prévia</h3>
      <div aria-label="Prévia da exportação CSV" className="csv-export-preview">
        {plan.issues.length ? (
          <div className="transfer-errors" role="alert">
            {plan.issues.map((i) => (
              <p key={i}>{i}</p>
            ))}
          </div>
        ) : (
          <>
            <table className="schedule-table">
              <thead>
                <tr>
                  <th>Escopo</th>
                  <th>Posições</th>
                  <th>Peças</th>
                  <th>Peso teórico (kg)</th>
                  <th>Acréscimo</th>
                </tr>
              </thead>
              <tbody>
                {plan.scopes.map((s, i) => (
                  <tr key={i}>
                    <td>{s.name}</td>
                    <td>{s.positions}</td>
                    <td>{s.pieces}</td>
                    <td>{kg(s.weight)}</td>
                    <td>{s.allowance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="field-help">
              {plan.files.length} arquivo(s)
              {plan.files.length > 1 ? ' em um ZIP' : ''} · quadro em{' '}
              {unit(o.detailedLength)}, resumo em {unit(o.summaryLength)},
              bitolas em mm, pesos em kg · UTF-8, “;”, decimal “{o.decimal}”
              {many > 1 && !o.physicalTotal
                ? ' · sem total físico consolidado'
                : ''}
            </p>
            <ul className="csv-export-files" aria-label="Arquivos">
              {plan.files.map((f) => (
                <li key={f.name}>{f.name}</li>
              ))}
            </ul>
          </>
        )}
        {plan.warnings.map((w) => (
          <p key={w} className="warning-text field-help">
            {w}
          </p>
        ))}
      </div>
      {issue && <p role="alert">{issue}</p>}
      <div className="modal-actions">
        <button disabled={busy} onClick={onClose}>
          Cancelar
        </button>
        <button
          className="primary"
          disabled={busy || !!plan.issues.length}
          onClick={async () => {
            setIssue('');
            setBusy(true);
            try {
              const result = await onExport(selection, o);
              if (result === true) onClose();
              else if (typeof result === 'string') setIssue(result);
            } catch (e) {
              setIssue(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Exportando…' : 'Exportar CSV'}
        </button>
      </div>
    </dialog>
  );
}
