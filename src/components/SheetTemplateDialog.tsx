import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  composeSheet,
  type PaperComposition,
  type PaperPrimitive,
  type PaperRect,
} from '../domain/paper';
import { initialSheet, sheetSize } from '../domain/paperFormat';
import {
  applySheetTemplate,
  decodeSheetTemplate,
  duplicateSheetTemplate,
  encodeSheetTemplate,
  paperRectFromPoints,
  removeSheetTemplate,
  saveSheetTemplate,
  sheetTemplateDecorations,
  sheetTemplateGeometryFromMask,
  templateFromSheet,
  validateSheetTemplate,
  type SheetTemplate,
} from '../domain/sheetTemplates';
import type { Point, Project, Sheet } from '../domain/types';
import { importMask, pickNativeFile, safeName, saveFile } from '../lib/files';
import SheetTemplateCalibration, {
  type ImportedTemplateGeometry,
} from './SheetTemplateCalibration';
import {
  TemplateArtworkFields,
  TemplatePaperFields,
} from './SheetTemplateFields';
import SheetTemplatePreview from './SheetTemplatePreview';
import './SheetTemplateDialog.css';

type Props = {
  project: Project;
  initialSheetId?: string;
  onClose: () => void;
  onCommit: (next: Project) => boolean;
};

type Application = {
  base: Project;
  next: Project;
  sheets: PaperComposition[];
};

type FileKind = 'model' | 'cad';
const extensions = { model: ['json'], cad: ['dxf', 'dwg'] };
const projectContext = (project: Project, sheetId?: string) =>
  `${project.id}:${sheetId ?? ''}`;
const errorMessage = (cause: unknown) =>
  cause instanceof Error
    ? cause.message
    : typeof cause === 'string'
      ? cause
      : 'Não foi possível concluir esta operação.';
const sheetFormatLabel = (size: { width: number; height: number }) =>
  `${size.width} × ${size.height} mm`;
const paperSetupLabel = (sheet: Pick<Sheet, 'format' | 'orientation'>) =>
  `${sheet.format === 'custom' ? 'Personalizado' : sheet.format} ${sheet.orientation === 'landscape' ? 'paisagem' : 'retrato'}`;

function initialTemplate(project: Project, sheetId?: string) {
  const sheet =
    project.sheets.find(({ id }) => id === sheetId) ??
    project.sheets[0] ??
    initialSheet('template-base');
  return templateFromSheet(sheet);
}

function previewRegions(template: SheetTemplate) {
  const regions: {
    box: PaperRect;
    label: string;
    kind: 'useful' | 'seal' | 'field';
  }[] = [{ box: template.useful, label: 'Área útil', kind: 'useful' }];
  if (template.seal)
    regions.push({
      box: template.seal,
      label: 'Reserva do selo',
      kind: 'seal',
    });
  regions.push(
    ...template.fields.map(({ box, label }) => ({
      box,
      label,
      kind: 'field' as const,
    })),
  );
  return regions;
}

function ApplicationPreview({
  application,
  onConfirm,
  onCancel,
}: {
  application: Application;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [sheetId, setSheetId] = useState(application.sheets[0].sheet.id);
  const scene =
    application.sheets.find(({ sheet }) => sheet.id === sheetId) ??
    application.sheets[0];
  return (
    <section className="template-application" aria-label="Prévia da aplicação">
      <h3>Prévia da aplicação</h3>
      <p>
        Nas folhas selecionadas serão aplicados formato, orientação, área útil,
        reserva do selo e conteúdo gráfico do modelo. A prévia usa as vistas,
        posições, escalas e quadro de aço atuais.
      </p>
      <ul className="template-impact">
        {application.sheets.map(({ sheet, size, useful, seal, issues }) => {
          const before = application.base.sheets.find(
            ({ id }) => id === sheet.id,
          )!;
          const names = new Map(
            application.next.hierarchy.placements
              .filter(({ sheetId }) => sheetId === sheet.id)
              .map((p) => [
                p.id,
                p.title ||
                  application.next.hierarchy.drawings.find(
                    ({ id }) => id === p.drawingId,
                  )?.name ||
                  'Vista sem título',
              ]),
          );
          return (
            <li key={sheet.id}>
              <strong>{sheet.name}</strong>
              <br />
              Papel {sheetFormatLabel(sheetSize(before))} →{' '}
              {sheetFormatLabel(size)}. Área útil {sheetFormatLabel(useful)}.{' '}
              {seal
                ? `Reserva do selo ${sheetFormatLabel(seal)}.`
                : 'Sem reserva de selo.'}
              <br />
              Formato {paperSetupLabel(before)} → {paperSetupLabel(sheet)}.
              {before.paperTemplate &&
                ` Modelo atual: ${before.paperTemplate.name} rev. ${before.paperTemplate.revision}.`}{' '}
              Modelo a aplicar: {sheet.paperTemplate?.name} rev.{' '}
              {sheet.paperTemplate?.revision}.
              {!!issues.length && (
                <ul className="template-alert">
                  {issues.map((issue, i) => (
                    <li key={i}>
                      {issue.viewId && names.get(issue.viewId)
                        ? `${names.get(issue.viewId)} · `
                        : ''}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {application.sheets.some(({ issues }) => issues.length > 0) && (
        <p className="template-alert">
          Resolva as incompatibilidades indicadas nas folhas antes de exportar.
        </p>
      )}
      {application.sheets.length > 1 && (
        <label className="template-field">
          <span>Folha na prévia</span>
          <select
            value={sheetId}
            onChange={(event) => setSheetId(event.target.value)}
          >
            {application.sheets.map(({ sheet }) => (
              <option key={sheet.id} value={sheet.id}>
                {sheet.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <SheetTemplatePreview
        label={`Prévia da aplicação em ${scene.sheet.name}`}
        size={scene.size}
        lines={[
          ...scene.decorations,
          ...scene.views.flatMap(({ lines }) => lines),
          ...(scene.schedule?.lines ?? []),
        ]}
      />
      <div className="template-buttons">
        <button type="button" onClick={onCancel}>
          Cancelar aplicação
        </button>
        <button type="button" className="primary" onClick={onConfirm}>
          Aplicar modelo às folhas selecionadas
        </button>
      </div>
    </section>
  );
}

export default function SheetTemplateDialog({
  project,
  initialSheetId,
  onClose,
  onCommit,
}: Props) {
  const id = useId();
  const modal = useRef<HTMLDialogElement>(null);
  const modelFile = useRef<HTMLInputElement>(null);
  const cadFile = useRef<HTMLInputElement>(null);
  const importTask = useRef<AbortController | undefined>(undefined);
  const commitInFlight = useRef<Project | undefined>(undefined);
  const templateList = project.sheetTemplates ?? [];
  const [draft, setDraft] = useState(() =>
    structuredClone(
      templateList[0] ?? initialTemplate(project, initialSheetId),
    ),
  );
  const [selected, setSelected] = useState(() => {
    const active =
      project.sheets.find(({ id }) => id === initialSheetId) ??
      project.sheets[0];
    return new Set(active ? [active.id] : []);
  });
  const [areaPoints, setAreaPoints] = useState<Point[]>();
  const [source, setSource] = useState<ImportedTemplateGeometry>();
  const [application, setApplication] = useState<Application>();
  const [removing, setRemoving] = useState(false);
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [importResolution, setImportResolution] = useState('');
  const context = useRef(projectContext(project, initialSheetId));
  const initialContext =
    context.current === projectContext(project, initialSheetId);
  const saved = templateList.find(({ id }) => id === draft.id);
  const draftChanged = saved
    ? JSON.stringify(saved) !== JSON.stringify(draft)
    : true;
  const paper = sheetSize(draft);
  const previewLines = useMemo(
    () =>
      sheetTemplateDecorations(draft).filter(
        (line) =>
          line.points.every(
            (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
          ) &&
          (!line.text ||
            (Number.isFinite(line.textHeight) &&
              Number.isFinite(line.textRotation ?? 0))),
      ),
    [draft],
  );
  const appliedCount = project.sheets.filter(
    ({ paperTemplate }) => paperTemplate?.id === draft.id,
  ).length;
  const activeApplication =
    application?.base === project ? application : undefined;

  useEffect(() => {
    const dialog = modal.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      const task = importTask.current;
      importTask.current = undefined;
      task?.abort();
      dialog?.close();
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    if (!initialContext) onClose();
  }, [initialContext, onClose]);

  const report = (cause: unknown) => {
    setNotice('');
    setError(errorMessage(cause));
  };
  const clearFeedback = () => {
    setNotice('');
    setError('');
  };
  const edit = (template: SheetTemplate) => {
    setDraft(template);
    setApplication(undefined);
    setRemoving(false);
    clearFeedback();
  };
  const switchDraft = (template: SheetTemplate) => {
    setAreaPoints(undefined);
    setSource(undefined);
    setImportResolution('');
    edit(structuredClone(template));
  };
  const commit = (next: Project, message: string) => {
    if (commitInFlight.current === project) return false;
    if (next !== project) {
      commitInFlight.current = project;
      if (!onCommit(next)) {
        commitInFlight.current = undefined;
        report(
          'O projeto mudou ou está protegido. Reabra o editor de modelos.',
        );
        return false;
      }
    }
    setError('');
    setNotice(message);
    return true;
  };
  const save = () => {
    try {
      const next = saveSheetTemplate(project, draft);
      if (
        !commit(
          next,
          next === project
            ? 'O modelo já está salvo.'
            : 'Modelo salvo na biblioteca do projeto.',
        )
      )
        return;
      setDraft(
        structuredClone(
          next.sheetTemplates!.find(({ id }) => id === draft.id)!,
        ),
      );
      setImportResolution('');
    } catch (cause) {
      report(cause);
    }
  };
  const remove = () => {
    const next = removeSheetTemplate(project, draft.id);
    if (!commit(next, 'Modelo removido da biblioteca.')) return;
    setDraft(
      structuredClone(
        next.sheetTemplates?.[0] ?? initialTemplate(next, initialSheetId),
      ),
    );
    setRemoving(false);
  };
  const exportModel = async () => {
    try {
      const validated = validateSheetTemplate(draft);
      if (
        await saveFile(
          `${safeName(validated.name)}.armstruct-sheet-template.json`,
          encodeSheetTemplate(validated),
          'application/json',
          'json',
        )
      ) {
        setNotice('Arquivo de modelo exportado.');
        setError('');
      }
    } catch (cause) {
      report(cause);
    }
  };
  const read = async (
    kind: FileKind,
    getFile: () => Promise<File | null | undefined>,
  ) => {
    if (importTask.current) return;
    const task = new AbortController();
    importTask.current = task;
    setReading(true);
    clearFeedback();
    try {
      const file = await getFile();
      if (!file || task.signal.aborted) return;
      if (kind === 'model') {
        if (file.size > 30 * 1024 * 1024)
          throw Error('Escolha um arquivo de modelo com até 30 MB.');
        const imported = decodeSheetTemplate(await file.text());
        if (task.signal.aborted) return;
        const nameKey = (name: string) =>
          name.normalize('NFC').toLocaleLowerCase('pt-BR');
        const sameName = templateList.some(
          (item) => nameKey(item.name) === nameKey(imported.name),
        );
        const sameId = templateList.some((item) => item.id === imported.id);
        const replacement =
          sameName || sameId
            ? duplicateSheetTemplate(
                imported,
                `${imported.name.slice(0, 136)} (importado)`,
              )
            : imported;
        switchDraft(replacement);
        if (sameName || sameId)
          setImportResolution(
            'Já existe um modelo com esse nome ou ID. Confira o nome sugerido e salve para importar uma cópia independente.',
          );
      } else {
        const mask = await importMask(file, task.signal);
        if (task.signal.aborted) return;
        const geometry = sheetTemplateGeometryFromMask(mask);
        if (!geometry.length)
          throw Error(
            'O desenho não contém entidades visíveis compatíveis para importar.',
          );
        const warnings = [...mask.warnings];
        const omitted = mask.primitives.length - geometry.length;
        if (omitted)
          warnings.push(
            `${omitted} entidades ocultas ou vazias ficaram fora da importação.`,
          );
        if (geometry.some(({ text, textFont }) => text && !textFont))
          warnings.push(
            'Textos CAD sem fonte reconhecida usam a fonte padrão Sans. Confira a prévia antes de importar.',
          );
        setAreaPoints(undefined);
        setApplication(undefined);
        setSource({
          fileName: file.name,
          sourceUnit: mask.sourceUnit,
          warnings,
          geometry,
        });
      }
    } catch (cause) {
      if (!task.signal.aborted) report(cause);
    } finally {
      if (importTask.current === task) {
        importTask.current = undefined;
        setReading(false);
      }
    }
  };
  const pick = (kind: FileKind) =>
    void read(kind, async () => {
      const file = await pickNativeFile(extensions[kind]);
      if (file === undefined)
        (kind === 'model' ? modelFile : cadFile).current?.click();
      return file;
    });
  const fromInput = (kind: FileKind, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void read(kind, async () => file);
  };
  const addImported = (geometry: PaperPrimitive[]) => {
    try {
      const candidate = {
        ...draft,
        geometry: [...draft.geometry, ...geometry],
      };
      validateSheetTemplate(candidate);
      edit(candidate);
      setSource(undefined);
      setNotice('Desenho calibrado adicionado ao rascunho.');
    } catch (cause) {
      report(cause);
    }
  };
  const choosePoint = (point: Point) => {
    if (!areaPoints?.length) {
      setAreaPoints([point]);
      return;
    }
    try {
      edit({ ...draft, useful: paperRectFromPoints(areaPoints[0], point) });
      setAreaPoints(undefined);
    } catch {
      report(
        'Marque um segundo ponto que forme uma área de largura e altura positivas.',
      );
    }
  };
  const previewApplication = () => {
    if (!saved || draftChanged) return;
    try {
      const next = applySheetTemplate(project, saved.id, [...selected]);
      setApplication({
        base: project,
        next,
        sheets: next.sheets
          .filter(({ id }) => selected.has(id))
          .map(({ id }) => composeSheet(next, id)),
      });
      clearFeedback();
    } catch (cause) {
      report(cause);
    }
  };

  return (
    <dialog
      className="modal sheet-template-dialog"
      ref={modal}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header>
        <h2 id={id}>Modelos de margem e selo</h2>
        <button
          type="button"
          aria-label="Fechar modelos de margem e selo"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="template-dialog-scroll">
        <input
          type="file"
          ref={modelFile}
          accept=".json"
          hidden
          aria-label="Arquivo de modelo de margem e selo"
          onChange={(event) => fromInput('model', event)}
        />
        <input
          type="file"
          ref={cadFile}
          accept=".dxf,.dwg"
          hidden
          aria-label="Arquivo CAD do modelo de prancha"
          onChange={(event) => fromInput('cad', event)}
        />
        <div className="template-editor-grid">
          <div className="template-editor-controls">
            <fieldset
              disabled={reading || !!source || !!activeApplication || removing}
            >
              <legend>Biblioteca do projeto</legend>
              <label className="template-field">
                <span>Modelo</span>
                <select
                  value={saved?.id ?? ''}
                  onChange={(event) => {
                    const template = templateList.find(
                      ({ id }) => id === event.target.value,
                    );
                    if (template) switchDraft(template);
                  }}
                >
                  {!saved && <option value="">Novo modelo</option>}
                  {templateList.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} · rev. {template.revision}
                    </option>
                  ))}
                </select>
              </label>
              <div className="template-buttons">
                <button
                  type="button"
                  onClick={() =>
                    switchDraft(initialTemplate(project, initialSheetId))
                  }
                >
                  Novo modelo da folha
                </button>
                <button
                  type="button"
                  onClick={() =>
                    switchDraft(
                      duplicateSheetTemplate(
                        draft,
                        `${draft.name.slice(0, 142)} cópia`,
                      ),
                    )
                  }
                >
                  Duplicar modelo
                </button>
                <button
                  type="button"
                  disabled={!saved}
                  onClick={() => setRemoving(true)}
                >
                  Remover modelo
                </button>
              </div>
              <div className="template-buttons">
                <button type="button" onClick={() => pick('model')}>
                  Importar modelo (.json)
                </button>
                <button
                  type="button"
                  disabled={!saved || draftChanged}
                  onClick={() => void exportModel()}
                >
                  Exportar modelo
                </button>
              </div>
            </fieldset>
            <fieldset
              disabled={reading || !!source || !!activeApplication || removing}
            >
              <legend>Dados do modelo</legend>
              <label className="template-field">
                <span>Nome do modelo</span>
                <input
                  autoFocus
                  value={draft.name}
                  maxLength={150}
                  onChange={(event) =>
                    edit({ ...draft, name: event.target.value })
                  }
                />
              </label>
              {saved && (
                <p className="template-hint">
                  Revisão {saved.revision}.{' '}
                  {appliedCount > 0
                    ? `O modelo foi aplicado a ${appliedCount} folha(s). Use a aplicação às pranchas para atualizá-las.`
                    : 'Selecione as folhas para aplicar este modelo.'}
                </p>
              )}
              {importResolution && (
                <p className="template-alert" role="status">
                  {importResolution}
                </p>
              )}
              <div className="template-buttons">
                <button type="button" onClick={() => pick('cad')}>
                  Importar desenho DXF/DWG
                </button>
              </div>
            </fieldset>
            {!reading && !source && !activeApplication && !removing && (
              <>
                <TemplatePaperFields
                  template={draft}
                  setTemplate={edit}
                  onChooseArea={() => {
                    setAreaPoints([]);
                    clearFeedback();
                  }}
                />
                <TemplateArtworkFields
                  key={draft.id}
                  template={draft}
                  setTemplate={edit}
                />
              </>
            )}
          </div>
          <div
            className={`template-preview-column${!source && !activeApplication ? ' editor-preview' : ''}`}
          >
            {source ? (
              <SheetTemplateCalibration
                source={source}
                paper={paper}
                onApply={addImported}
                onCancel={() => {
                  setSource(undefined);
                  clearFeedback();
                }}
              />
            ) : activeApplication ? (
              <ApplicationPreview
                key={saved?.id}
                application={activeApplication}
                onCancel={() => setApplication(undefined)}
                onConfirm={() => {
                  if (
                    commit(
                      activeApplication.next,
                      `Modelo aplicado a ${activeApplication.sheets.length} folha(s).`,
                    )
                  )
                    setApplication(undefined);
                }}
              />
            ) : (
              <>
                <h3>Prévia do modelo</h3>
                {areaPoints && (
                  <p role="status">
                    Marque o {areaPoints.length === 0 ? 'primeiro' : 'segundo'}{' '}
                    canto da área útil no papel.
                  </p>
                )}
                <SheetTemplatePreview
                  size={paper}
                  lines={previewLines}
                  regions={previewRegions(draft)}
                  points={areaPoints}
                  onPick={areaPoints ? choosePoint : undefined}
                  label="Modelo e regiões em milímetros de papel"
                />
                {areaPoints && (
                  <button
                    type="button"
                    onClick={() => setAreaPoints(undefined)}
                  >
                    Cancelar marcação
                  </button>
                )}
                {removing ? (
                  <section aria-label="Confirmar remoção do modelo">
                    <h3>Remover {draft.name} da biblioteca?</h3>
                    <p>
                      As revisões já aplicadas continuam incorporadas às folhas.
                    </p>
                    <div className="template-buttons">
                      <button type="button" onClick={() => setRemoving(false)}>
                        Cancelar remoção
                      </button>
                      <button type="button" onClick={remove}>
                        Confirmar remoção do modelo
                      </button>
                    </div>
                  </section>
                ) : (
                  <fieldset
                    disabled={!saved || draftChanged || reading || !!areaPoints}
                  >
                    <legend>Aplicar às pranchas</legend>
                    {!project.sheets.length && (
                      <p>
                        Crie uma folha no gerenciador de pranchas para aplicar o
                        modelo.
                      </p>
                    )}
                    {project.sheets.map((sheet) => (
                      <label className="template-check" key={sheet.id}>
                        <input
                          type="checkbox"
                          checked={selected.has(sheet.id)}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setSelected((value) => {
                              const next = new Set(value);
                              if (checked) next.add(sheet.id);
                              else next.delete(sheet.id);
                              return next;
                            });
                          }}
                        />
                        <span>
                          {sheet.name} · {sheetFormatLabel(sheetSize(sheet))}
                          {sheet.paperTemplate
                            ? ` · ${sheet.paperTemplate.name} rev. ${sheet.paperTemplate.revision}`
                            : ''}
                        </span>
                      </label>
                    ))}
                    <button
                      type="button"
                      disabled={selected.size === 0}
                      onClick={previewApplication}
                    >
                      Conferir aplicação
                    </button>
                  </fieldset>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <footer>
        {error && (
          <p role="alert" className="template-alert">
            {error}
          </p>
        )}
        {!error && (notice || reading) && (
          <p role="status">{reading ? 'Lendo arquivo…' : notice}</p>
        )}
        <div className="template-buttons">
          <button type="button" onClick={onClose}>
            Fechar
          </button>
          <button
            type="button"
            className="primary"
            disabled={
              reading ||
              !!areaPoints ||
              !!source ||
              !!activeApplication ||
              removing ||
              !draftChanged
            }
            onClick={save}
          >
            Salvar modelo
          </button>
        </div>
      </footer>
    </dialog>
  );
}
