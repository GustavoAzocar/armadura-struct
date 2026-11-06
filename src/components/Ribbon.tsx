import {
  Copy,
  Download,
  FilePlus2,
  FileText,
  FlipHorizontal2,
  FolderOpen,
  Grid2X2,
  Hand,
  HelpCircle,
  Layers,
  Maximize2,
  MousePointer2,
  Move,
  PencilRuler,
  Redo2,
  RotateCw,
  Ruler,
  Save,
  ScanLine,
  Shapes,
  SquareDashed,
  Table2,
  Trash2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import type { Tool } from '../domain/types';
export type Action =
  | Tool
  | 'new'
  | 'open'
  | 'save'
  | 'import'
  | 'undo'
  | 'redo'
  | 'delete'
  | 'rotate'
  | 'mirror'
  | 'fit'
  | 'grid'
  | 'snap'
  | 'ortho'
  | 'dimensions'
  | 'pdf'
  | 'dxf'
  | 'csv'
  | 'schedule'
  | 'help';
type Item = {
  action: Action;
  label: string;
  icon: LucideIcon;
  large?: boolean;
};
const item = (
  action: Action,
  label: string,
  icon: LucideIcon,
  large = false,
): Item => ({ action, label, icon, large });
export default function Ribbon({
  tab,
  setTab,
  onAction,
  active,
  selected,
  canUndo,
  canRedo,
}: {
  tab: string;
  setTab: (s: string) => void;
  onAction: (a: Action) => void;
  active: Partial<Record<Action, boolean>>;
  selected: boolean;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const groups: Record<string, { name: string; items: Item[] }[]> = {
    Armaduras: [
      {
        name: 'Navegação',
        items: [
          item('select', 'Selecionar', MousePointer2, true),
          item('pan', 'Pan', Hand),
        ],
      },
      {
        name: 'Criar armadura',
        items: [
          item('bar', 'Barra livre', PencilRuler, true),
          item('stirrup', 'Estribo', SquareDashed, true),
          item('follow', 'Seguir fôrma', ScanLine, true),
        ],
      },
      {
        name: 'Detalhamento',
        items: [
          item('detail', 'Rebatimento', Shapes, true),
          item('distribute', 'Distribuir', Layers, true),
          item('measure', 'Medir', Ruler),
        ],
      },
      {
        name: 'Referências',
        items: [item('import', 'Importar máscara', FolderOpen, true)],
      },
      {
        name: 'Documentação',
        items: [
          item('schedule', 'Quadro de aço', Table2, true),
          item('pdf', 'PDF', FileText),
          item('dxf', 'DXF', Download),
        ],
      },
    ],
    Editar: [
      {
        name: 'Histórico',
        items: [
          item('undo', 'Desfazer', Undo2, true),
          item('redo', 'Refazer', Redo2, true),
        ],
      },
      {
        name: 'Transformar seleção',
        items: [
          item('move', 'Mover', Move, true),
          item('copy', 'Copiar', Copy, true),
          item('rotate', 'Girar 90°', RotateCw, true),
          item('mirror', 'Espelhar', FlipHorizontal2, true),
          item('delete', 'Excluir', Trash2, true),
        ],
      },
      {
        name: 'Desenho',
        items: [
          item('bar', 'Barra livre', PencilRuler, true),
          item('stirrup', 'Estribo', SquareDashed, true),
        ],
      },
    ],
    Exibir: [
      {
        name: 'Navegação',
        items: [
          item('select', 'Selecionar', MousePointer2, true),
          item('pan', 'Pan', Hand, true),
          item('fit', 'Enquadrar', Maximize2, true),
        ],
      },
      {
        name: 'Precisão',
        items: [
          item('grid', 'Grade', Grid2X2, true),
          item('snap', 'Encaixes', ScanLine, true),
          item('ortho', 'Ortogonal', SquareDashed, true),
          item('dimensions', 'Cotas', Ruler, true),
        ],
      },
      {
        name: 'Documentos',
        items: [
          item('schedule', 'Quadro de aço', Table2, true),
          item('help', 'Guia de uso', HelpCircle, true),
        ],
      },
    ],
    Arquivo: [
      {
        name: 'Projeto',
        items: [
          item('new', 'Novo projeto', FilePlus2, true),
          item('open', 'Abrir projeto', FolderOpen, true),
          item('save', 'Salvar projeto', Save, true),
        ],
      },
      {
        name: 'Importar',
        items: [item('import', 'Máscara DXF / DWG', Layers, true)],
      },
      {
        name: 'Exportar',
        items: [
          item('pdf', 'Prancha PDF', FileText, true),
          item('dxf', 'Desenho DXF', Download, true),
          item('csv', 'Quadro CSV', Table2, true),
        ],
      },
      { name: 'Ajuda', items: [item('help', 'Guia de uso', HelpCircle, true)] },
    ],
  };
  return (
    <div className="ribbon">
      <div className="ribbon-tabs" role="tablist" aria-label="Ferramentas">
        {Object.keys(groups).map((t) => (
          <button
            role="tab"
            aria-selected={t === tab}
            key={t}
            className={t === tab ? 'active' : ''}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
        <div className="ribbon-tag">
          <span /> DETALHAMENTO INTELIGENTE
        </div>
      </div>
      <div className="ribbon-content">
        {groups[tab].map((g) => (
          <div key={g.name} className="ribbon-group">
            <div className="ribbon-group-tools">
              {g.items.map((t) => (
                <button
                  key={t.action}
                  className={`ribbon-tool ${t.large ? 'large' : ''} ${active[t.action] ? 'active' : ''}`}
                  onClick={() => onAction(t.action)}
                  title={t.label}
                  disabled={
                    ([
                      'move',
                      'copy',
                      'detail',
                      'distribute',
                      'rotate',
                      'mirror',
                      'delete',
                    ].includes(t.action) &&
                      !selected) ||
                    (t.action === 'undo' && !canUndo) ||
                    (t.action === 'redo' && !canRedo)
                  }
                >
                  <t.icon size={t.large ? 25 : 17} strokeWidth={1.6} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
            <span className="ribbon-group-label">{g.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
