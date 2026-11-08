import { setSheetSchedule } from '../domain/sheetSchedule';
import { useMemo, useState } from 'react';
import { Copy, Plus, ArrowUp, ArrowDown, X, ExternalLink } from 'lucide-react';
import type { Project, SheetFormat } from '../domain/types';
import { detailPath } from '../domain/hierarchy';
import { drawingLabel } from '../domain/hierarchyPresentation';
import {
  createSheet,
  deleteSheet,
  duplicateSheet,
  duplicatePlacement,
  placeDrawing,
  removePlacement,
  reorderSheet,
  unplacedDrawings,
  updatePlacement,
  updateSheet,
} from '../domain/sheets';
import { NumberField, TextField } from './Panels';
import { SheetPaperFields, ViewPaperFields } from './PaperFields';
import { composeSheet } from '../domain/paper';

type Props = {
  project: Project;
  onInsertSchedule: () => void;
  sheetId?: string;
  selectedView?: string;
  onSelectView: (id?: string) => void;
  onChange: (change: (p: Project) => Project) => boolean;
  onOpenSheet: (id: string) => void;
  onOpenDrawing: (id: string) => void;
  locked: boolean;
  onExportAll: () => void;
};
export default function SheetManager({
  project: p,
  sheetId,
  selectedView,
  onSelectView,
  onChange,
  onOpenSheet,
  onOpenDrawing,
  locked,
  onExportAll,
  onInsertSchedule,
}: Props) {
  const [newName, setNewName] = useState('');
  const sheet = p.sheets.find((s) => s.id === sheetId);
  const views = p.hierarchy.placements.filter((v) => v.sheetId === sheetId);
  const view = views.find((v) => v.id === selectedView);
  const unplaced = unplacedDrawings(p);
  const composition = useMemo(
    () => (sheet ? composeSheet(p, sheet.id) : undefined),
    [p, sheet],
  );
  const add = () => {
    const result = createSheet(
      p,
      newName.trim() || `Folha ${p.sheets.length + 1}`,
    );
    if (onChange(() => result.project)) {
      setNewName('');
      onOpenSheet(result.id);
    }
  };
  return (
    <div className="sheet-manager">
      <div className="panel-heading">
        <b>Gerenciador de pranchas</b>
        <small>{p.sheets.length} folhas</small>
      </div>
      <div className="panel-scroll">
        {locked && (
          <p className="field-help">
            Conclua a edição para alterar as folhas. Você pode abrir outra aba
            para consultar o projeto.
          </p>
        )}
        <form
          className="sheet-create"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            aria-label="Nome da nova folha"
            value={newName}
            maxLength={100}
            placeholder="Nova folha vazia"
            onChange={(e) => setNewName(e.target.value)}
            disabled={locked}
          />
          <button
            title="Criar folha vazia"
            aria-label="Criar folha vazia"
            disabled={locked}
          >
            <Plus size={14} />
          </button>
        </form>
        <div className="sheet-list" aria-label="Folhas do projeto">
          {!p.sheets.length && (
            <p className="field-help">
              Nenhuma folha. Os desenhos continuam no modelo.
            </p>
          )}
          {p.sheets.map((s, index) => {
            const count = p.hierarchy.placements.filter(
              (v) => v.sheetId === s.id,
            ).length;
            return (
              <div
                className={`sheet-row ${s.id === sheetId ? 'selected' : ''}`}
                key={s.id}
              >
                <button
                  className="sheet-open"
                  onClick={() => onOpenSheet(s.id)}
                  title={`Abrir ${s.name}`}
                  aria-label={`Abrir ${s.name}`}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <b>{s.name}</b>
                  <small>{count ? `${count} vista(s)` : 'Vazia'}</small>
                </button>
              </div>
            );
          })}
        </div>
        {sheet && (
          <fieldset className="sheet-properties" disabled={locked}>
            <legend>Propriedades da folha</legend>
            <TextField
              label="Nome da folha"
              maxLength={100}
              value={sheet.name}
              onChange={(name) =>
                onChange((p) => updateSheet(p, sheet.id, { name }))
              }
            />
            <label>
              Formato
              <select
                aria-label="Formato da folha"
                value={sheet.format}
                onChange={(e) =>
                  onChange((p) =>
                    updateSheet(p, sheet.id, {
                      format: e.target.value as SheetFormat,
                    }),
                  )
                }
              >
                {['A0', 'A1', 'A2', 'A3', 'A4', 'custom'].map((f) => (
                  <option key={f} value={f}>
                    {f === 'custom' ? 'Personalizado' : f}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Orientação
              <select
                aria-label="Orientação da folha"
                value={sheet.orientation}
                onChange={(e) =>
                  onChange((p) =>
                    updateSheet(p, sheet.id, {
                      orientation: e.target.value as 'portrait' | 'landscape',
                    }),
                  )
                }
              >
                <option value="landscape">Paisagem</option>
                <option value="portrait">Retrato</option>
              </select>
            </label>
            <SheetPaperFields sheet={sheet} onChange={onChange} />
            <TextField
              label="Revisão da folha"
              maxLength={40}
              allowEmpty
              value={sheet.properties.revision}
              onChange={(revision) =>
                onChange((p) =>
                  updateSheet(p, sheet.id, {
                    properties: { ...sheet.properties, revision },
                  }),
                )
              }
            />
            <TextField
              label="Notas da folha"
              maxLength={5000}
              allowEmpty
              value={sheet.properties.notes}
              onChange={(notes) =>
                onChange((p) =>
                  updateSheet(p, sheet.id, {
                    properties: { ...sheet.properties, notes },
                  }),
                )
              }
            />
            <div className="sheet-actions">
              <button
                title="Mover folha para cima"
                aria-label="Mover folha para cima"
                disabled={locked || p.sheets[0].id === sheet.id}
                onClick={() => onChange((p) => reorderSheet(p, sheet.id, -1))}
              >
                <ArrowUp size={14} />
              </button>
              <button
                title="Mover folha para baixo"
                aria-label="Mover folha para baixo"
                disabled={locked || p.sheets.at(-1)?.id === sheet.id}
                onClick={() => onChange((p) => reorderSheet(p, sheet.id, 1))}
              >
                <ArrowDown size={14} />
              </button>
              <button
                onClick={() => {
                  const result = duplicateSheet(p, sheet.id);
                  if (onChange(() => result.project)) onOpenSheet(result.id);
                }}
              >
                <Copy size={14} />
                Duplicar layout
              </button>
              <button
                className="danger"
                onClick={() => onChange((p) => deleteSheet(p, sheet.id))}
              >
                <X size={14} />
                Excluir folha
              </button>
            </div>
            <p className="field-help">
              Excluir remove esta folha e suas {views.length} vista(s). Os
              desenhos e as armaduras permanecem no modelo. Use Desfazer para
              restaurar.
            </p>
          </fieldset>
        )}
        {sheet && (
          <fieldset className="sheet-properties" disabled={locked}>
            <legend>Quadro de aço desta folha</legend>
            <button onClick={onInsertSchedule}>
              {sheet.steelSchedule
                ? 'Reposicionar quadro de aço'
                : 'Inserir quadro na prancha'}
            </button>
            {sheet.steelSchedule && (
              <>
                <p className="field-help">
                  Vinculado aos detalhamentos colocados; várias vistas da mesma
                  peça não multiplicam o aço. Arraste o quadro no papel para
                  movê-lo.
                </p>
                <NumberField
                  label="Quadro X"
                  value={sheet.steelSchedule.origin.x}
                  suffix="mm"
                  onChange={(x) =>
                    onChange((p) =>
                      setSheetSchedule(p, sheet.id, {
                        ...sheet.steelSchedule!,
                        origin: { ...sheet.steelSchedule!.origin, x },
                      }),
                    )
                  }
                />
                <NumberField
                  label="Quadro Y"
                  value={sheet.steelSchedule.origin.y}
                  suffix="mm"
                  onChange={(y) =>
                    onChange((p) =>
                      setSheetSchedule(p, sheet.id, {
                        ...sheet.steelSchedule!,
                        origin: { ...sheet.steelSchedule!.origin, y },
                      }),
                    )
                  }
                />
                <NumberField
                  label="Texto do quadro"
                  value={sheet.steelSchedule.textHeight}
                  min={1.8}
                  max={5}
                  suffix="mm"
                  onChange={(textHeight) =>
                    onChange((p) =>
                      setSheetSchedule(p, sheet.id, {
                        ...sheet.steelSchedule!,
                        textHeight,
                      }),
                    )
                  }
                />
                <NumberField
                  label="Reserva de peso do quadro"
                  value={sheet.steelSchedule.allowancePercent}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(allowancePercent) =>
                    onChange((p) =>
                      setSheetSchedule(p, sheet.id, {
                        ...sheet.steelSchedule!,
                        allowancePercent,
                      }),
                    )
                  }
                />
                <button
                  onClick={() =>
                    onChange((p) => setSheetSchedule(p, sheet.id, undefined))
                  }
                >
                  Retirar quadro da folha
                </button>
              </>
            )}
          </fieldset>
        )}
        {sheet && (
          <>
            <h3>Vistas nesta folha</h3>
            {!views.length && (
              <p className="field-help">
                Folha vazia. Coloque um desenho abaixo.
              </p>
            )}
            <div className="sheet-view-list">
              {views.map((v) => {
                const drawing = p.hierarchy.drawings.find(
                  (d) => d.id === v.drawingId,
                )!;
                return (
                  <div
                    key={v.id}
                    className={view?.id === v.id ? 'selected' : ''}
                  >
                    <button
                      onClick={() => onSelectView(v.id)}
                      title={detailPath(p, drawing.detailId)}
                    >
                      {drawingLabel(p, drawing)}
                    </button>
                    <button
                      title="Abrir desenho em aba"
                      aria-label={`Abrir desenho ${drawingLabel(p, drawing)}`}
                      onClick={() => onOpenDrawing(drawing.id)}
                    >
                      <ExternalLink size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
            {view && (
              <fieldset disabled={locked} className="sheet-properties">
                <legend>Vista selecionada · mm no papel</legend>
                <ViewPaperFields view={view} onChange={onChange} />
                <NumberField
                  label="Vista X"
                  value={view.origin.x}
                  onChange={(x) =>
                    onChange((p) =>
                      updatePlacement(p, view.id, {
                        origin: { ...view.origin, x },
                      }),
                    )
                  }
                />
                <NumberField
                  label="Vista Y"
                  value={view.origin.y}
                  onChange={(y) =>
                    onChange((p) =>
                      updatePlacement(p, view.id, {
                        origin: { ...view.origin, y },
                      }),
                    )
                  }
                />
                <NumberField
                  label="Largura da vista"
                  value={view.frame.width}
                  min={1}
                  onChange={(width) =>
                    onChange((p) =>
                      updatePlacement(p, view.id, {
                        frame: { ...view.frame, width },
                      }),
                    )
                  }
                />
                <NumberField
                  label="Altura da vista"
                  value={view.frame.height}
                  min={1}
                  onChange={(height) =>
                    onChange((p) =>
                      updatePlacement(p, view.id, {
                        frame: { ...view.frame, height },
                      }),
                    )
                  }
                />
                <NumberField
                  label="Rotação da vista"
                  value={view.rotation}
                  onChange={(rotation) =>
                    onChange((p) => updatePlacement(p, view.id, { rotation }))
                  }
                  suffix="°"
                />
                <button
                  onClick={() => {
                    const result = duplicatePlacement(p, view.id);
                    if (onChange(() => result.project)) onSelectView(result.id);
                  }}
                >
                  Duplicar vista
                </button>
                <button
                  onClick={() => onChange((p) => removePlacement(p, view.id))}
                >
                  Retirar vista da folha
                </button>
              </fieldset>
            )}
            <label className="place-drawing">
              Colocar desenho
              <select
                aria-label="Colocar desenho na folha"
                value=""
                disabled={locked}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const result = placeDrawing(p, sheet.id, e.target.value);
                  if (onChange(() => result.project)) onSelectView(result.id);
                }}
              >
                <option value="">Escolha um desenho…</option>
                {p.hierarchy.drawings.map((d) => (
                  <option key={d.id} value={d.id}>
                    {detailPath(p, d.detailId)}
                    {drawingLabel(p, d) ===
                    p.hierarchy.details.find((n) => n.id === d.detailId)?.name
                      ? ''
                      : ` · ${d.name}`}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {composition && (
          <div
            className={`paper-validation ${composition.issues.length ? 'invalid' : ''}`}
            role="region"
            aria-label="Validação da composição"
          >
            <b>
              {composition.issues.length
                ? `${composition.issues.length} problema(s) de composição`
                : 'Composição válida para PDF'}
            </b>
            {composition.issues.map((issue, i) => (
              <button
                key={i}
                onClick={() => issue.viewId && onSelectView(issue.viewId)}
              >
                {issue.message}
              </button>
            ))}
            <p className="field-help">
              Não há recorte silencioso: transbordamentos bloqueiam a
              exportação.
            </p>
          </div>
        )}
        <button
          className="paper-export-all"
          onClick={onExportAll}
          disabled={!p.sheets.length}
        >
          Exportar todas as folhas em PDF
        </button>
        <h3>Desenhos não colocados ({unplaced.length})</h3>
        <div className="unplaced-drawings">
          {unplaced.map((d) => (
            <button
              key={d.id}
              onClick={() => onOpenDrawing(d.id)}
              title={detailPath(p, d.detailId)}
            >
              <ExternalLink size={13} />
              <span>
                {detailPath(p, d.detailId)}
                {drawingLabel(p, d) ===
                p.hierarchy.details.find((n) => n.id === d.detailId)?.name
                  ? ''
                  : ` · ${d.name}`}
              </span>
            </button>
          ))}
        </div>
        {!unplaced.length && (
          <p className="field-help">
            Todos os desenhos têm ao menos uma vista.
          </p>
        )}
        <p className="field-help">
          O PDF usa as mesmas geometrias do espaço de papel e declara a escala
          de cada vista. Imprima em tamanho real (100%). Desenhos não colocados
          não entram nas folhas.
        </p>
      </div>
    </div>
  );
}
