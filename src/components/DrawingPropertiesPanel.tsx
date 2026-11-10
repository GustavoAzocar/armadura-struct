import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { DetailDrawing, Project } from '../domain/types';
import {
  DRAWING_METADATA_LIMITS,
  drawingHierarchyContext,
  drawingMetadataIssues,
  formatDrawingDate,
  sameDrawingMetadata,
  type DrawingMetadataField,
  type DrawingMetadataInput,
} from '../domain/drawingMetadata';

export type DrawingPropertiesSession = {
  key: number;
  projectId: string;
  drawingId: string;
  baseDrawing: DetailDrawing;
  contextKey: string;
  detailId: string;
};

export default function DrawingPropertiesPanel({
  project,
  session,
  onSave,
  onCancel,
}: {
  project: Project;
  session: DrawingPropertiesSession;
  onSave: (
    session: DrawingPropertiesSession,
    draft: DrawingMetadataInput,
  ) => boolean;
  onCancel: () => void;
}) {
  const [name, setName] = useState(session.baseDrawing.name);
  const [author, setAuthor] = useState(session.baseDrawing.author ?? '');
  const [date, setDate] = useState(session.baseDrawing.date ?? '');
  const [notes, setNotes] = useState(session.baseDrawing.notes ?? '');
  const [showErrors, setShowErrors] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const panelRef = useRef<HTMLElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, []);

  const close = () => {
    const previous = triggerRef.current;
    onCancel();
    if (previous?.isConnected) {
      requestAnimationFrame(() => previous.focus());
    }
  };

  const context = useMemo(
    () => drawingHierarchyContext(project, session.drawingId),
    [project, session.drawingId],
  );

  const stale =
    !context || !sameDrawingMetadata(context.drawing, session.baseDrawing);

  const draft: DrawingMetadataInput = { name, author, date, notes };
  const issues = useMemo(
    () => drawingMetadataIssues(draft),
    [name, author, date, notes],
  );

  const issueFor = (field: DrawingMetadataField) =>
    showErrors ? issues.find((i) => i.field === field)?.message : undefined;

  return (
    <section
      ref={panelRef}
      className="drawing-properties-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="drawing-properties-title"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      }}
    >
      <div className="drawing-properties-header">
        <div>
          <span className="eyebrow">DOCUMENTAÇÃO DO DESENHO</span>
          <h3 id="drawing-properties-title">Propriedades do desenho</h3>
        </div>
        <button
          type="button"
          className="drawing-properties-close"
          aria-label="Fechar propriedades do desenho"
          onClick={close}
        >
          <X size={14} />
        </button>
      </div>

      {context && (
        <dl
          className="drawing-hierarchy-summary"
          aria-label="Associação na hierarquia"
        >
          <div>
            <dt>Pavimento</dt>
            <dd data-testid="drawing-meta-floor">{context.floor.name}</dd>
          </div>
          <div>
            <dt>Elemento</dt>
            <dd data-testid="drawing-meta-element">{context.element.name}</dd>
          </div>
          <div>
            <dt>Detalhamento</dt>
            <dd data-testid="drawing-meta-detail">{context.detailLabel}</dd>
          </div>
        </dl>
      )}
      <p className="field-help">
        Associação derivada da hierarquia (somente leitura). Estes metadados
        pertencem apenas a este desenho e não alteram o projeto nem a prancha.
      </p>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (savingRef.current || stale) return;
          setShowErrors(true);
          setSubmitError('');
          if (issues.length) {
            requestAnimationFrame(() =>
              panelRef.current
                ?.querySelector<HTMLElement>('[aria-invalid="true"]')
                ?.focus(),
            );
            return;
          }
          savingRef.current = true;
          try {
            if (!onSave(session, draft)) {
              savingRef.current = false;
              setSubmitError(
                'Não foi possível salvar as propriedades deste desenho.',
              );
            }
          } catch (err) {
            savingRef.current = false;
            setSubmitError(
              err instanceof Error
                ? err.message
                : 'Não foi possível salvar as propriedades deste desenho.',
            );
          }
        }}
      >
        <label className="field">
          <span>Título do desenho</span>
          <input
            ref={titleInputRef}
            type="text"
            aria-label="Título do desenho"
            aria-invalid={!!issueFor('name')}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSubmitError('');
            }}
          />
          <small className="field-help">
            Identifica este desenho na árvore, nas abas e na colocação em
            pranchas (1 a {DRAWING_METADATA_LIMITS.name} caracteres).
          </small>
        </label>

        <div className="drawing-properties-grid">
          <label className="field">
            <span>Autor informado</span>
            <input
              type="text"
              autoComplete="off"
              aria-label="Autor informado"
              aria-invalid={!!issueFor('author')}
              placeholder="Opcional"
              value={author}
              onChange={(e) => {
                setAuthor(e.target.value);
                setSubmitError('');
              }}
            />
            <small className="field-help">
              Informado pelo usuário (até {DRAWING_METADATA_LIMITS.author}{' '}
              caracteres); não é assinatura verificada.
            </small>
          </label>

          <div className="field">
            <label htmlFor={`drawing-date-${session.key}`}>
              <span>Data documental</span>
            </label>
            <div className="drawing-date-row">
              <input
                id={`drawing-date-${session.key}`}
                type="date"
                aria-label="Data documental"
                aria-invalid={!!issueFor('date')}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setSubmitError('');
                }}
              />
              {date && (
                <button
                  type="button"
                  onClick={() => {
                    setDate('');
                    setSubmitError('');
                  }}
                >
                  Limpar data
                </button>
              )}
            </div>
            <small className="field-help">
              {date && formatDrawingDate(date)
                ? `Data civil ${formatDrawingDate(date)} (sem horário ou fuso).`
                : 'Data civil sem horário (AAAA-MM-DD). Pode ficar vazia.'}
            </small>
          </div>
        </div>

        <label className="field">
          <span>Comentários</span>
          <textarea
            rows={3}
            aria-label="Comentários do desenho"
            aria-invalid={!!issueFor('notes')}
            placeholder="Observações documentais deste desenho (opcional)"
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setSubmitError('');
            }}
          />
          <small className="field-help">
            Texto puro específico deste desenho ({notes.trim().length}/
            {DRAWING_METADATA_LIMITS.notes} caracteres).
          </small>
        </label>

        {stale && (
          <p className="drawing-properties-error" role="alert">
            Os dados deste desenho mudaram fora deste formulário. Cancele e
            reabra para conferir antes de salvar.
          </p>
        )}

        {!stale && showErrors && issues.length > 0 && (
          <p className="drawing-properties-error" role="alert">
            {issues.map((i) => i.message).join(' ')}
          </p>
        )}

        {!stale && submitError && (
          <p className="drawing-properties-error" role="alert">
            {submitError}
          </p>
        )}

        <div className="drawing-properties-actions">
          <button type="button" onClick={close}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={stale}>
            Salvar
          </button>
        </div>
      </form>
    </section>
  );
}
