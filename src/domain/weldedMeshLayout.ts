import ClipperLib from 'clipper-lib';
import {
  weldedMeshCriteriaIssues,
  type WeldedMeshCriteria,
  type WeldedMeshDefinition,
} from './weldedMesh';
import type { WeldedMeshRegion } from './weldedMeshRegion';
import type { Point } from './types';

/**
 * Paginação de telas soldadas sobre a região útil e quantitativos nominais.
 *
 * Referencial da tela: `u` segue o comprimento do painel (fios longitudinais),
 * a `orientation` graus de +X; `v` segue a largura. Os cantos de início
 * (`start`) se referem a esse referencial: esquerda/direita = −u/+u,
 * inferior/superior = −v/+v.
 *
 * Paginação conservadora: grade de painéis ancorada no canto de início (ou num
 * ponto informado), com passo = dimensão do painel − sobreposição em cada eixo.
 * Cada célula que toca a região útil é um painel-base, mesmo que gere peças
 * separadas; não há reaproveitamento de retalhos nem otimização de corte.
 *
 * Quantitativos (mm², kg), sem arredondar:
 * - área útil: região após afastamentos, sem contar emendas;
 * - área aplicada: soma das peças colocadas (cada camada física uma vez);
 * - sobreposição: área aplicada − área útil (material duplicado nas emendas);
 * - retalhos: painéis-base × área do painel − área aplicada;
 * - massa aplicada = área aplicada × kg/m²; massa de fornecimento =
 *   painéis-base × kg/painel (valores nominais independentes do cadastro).
 *
 * Recorte com `clipper-lib`, em inteiros de 0,001 mm relativos ao 1º vértice
 * da região (precisão independente da posição no desenho).
 */
export const LAYOUT_MAX_PANELS = 5000;
export const LAYOUT_MAX_WIRES = 20000;
/** mm²: peças menores que isso são resíduo numérico do recorte. */
const AREA_EPS = 1;
const PRECISION = 1000;
const EPS = 1e-6;

export type LayoutPiece = {
  /** mm do modelo, anti-horário. */
  outline: Point[];
  /** Furos da peça (aberturas inteiras dentro do painel), horários. */
  holes: Point[][];
  /** mm² */
  area: number;
  /** Peça menor que o painel inteiro. */
  cut: boolean;
};
export type LayoutPanel = {
  /** 1, 2, 3… na ordem da paginação (fileira, depois coluna). */
  number: number;
  /** Contadas a partir do canto de início. */
  row: number;
  column: number;
  /** Retângulo nominal do painel no modelo, anti-horário. */
  rect: Point[];
  /** Canto inicial do painel no referencial da tela (mm). */
  local: { u: number; v: number };
  pieces: LayoutPiece[];
  /** mm² */
  appliedArea: number;
};
export type WeldedMeshLayout = {
  mesh: WeldedMeshDefinition;
  frame: { origin: Point; orientation: number };
  /** Região útil (após afastamentos), mm do modelo. */
  useful: { outline: Point[]; holes: Point[][] }[];
  usefulArea: number;
  appliedArea: number;
  overlapArea: number;
  wasteArea: number;
  basePanels: number;
  fullPanels: number;
  cutPieces: number;
  /** kg */
  appliedMass: number;
  /** kg */
  supplyMass: number;
  panels: LayoutPanel[];
  /** Hipóteses que a prévia e o quadro devem mostrar. */
  assumptions: string[];
  warnings: string[];
};
export type LayoutResult =
  | { ok: true; layout: WeldedMeshLayout }
  | { ok: false; reason: string };

type Frame = { origin: Point; u: Point; v: Point };
type IntPiece = { outer: ClipperLib.Path; holes: ClipperLib.Path[] };

const fmt = (v: number) =>
  v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const frameOf = (origin: Point, orientation: number): Frame => {
  const a = (orientation * Math.PI) / 180;
  return {
    origin,
    u: { x: Math.cos(a), y: Math.sin(a) },
    v: { x: -Math.sin(a), y: Math.cos(a) },
  };
};
const toLocal = (f: Frame, p: Point) => {
  const dx = p.x - f.origin.x,
    dy = p.y - f.origin.y;
  return { x: dx * f.u.x + dy * f.u.y, y: dx * f.v.x + dy * f.v.y };
};
const toModel = (f: Frame, q: Point) => ({
  x: f.origin.x + q.x * f.u.x + q.y * f.v.x,
  y: f.origin.y + q.x * f.u.y + q.y * f.v.y,
});
const toInt = (p: Point): ClipperLib.IntPoint => ({
  X: Math.round(p.x * PRECISION),
  Y: Math.round(p.y * PRECISION),
});
const fromInt = (q: ClipperLib.IntPoint): Point => ({
  x: q.X / PRECISION,
  y: q.Y / PRECISION,
});
const positive = (path: ClipperLib.Path) =>
  ClipperLib.Clipper.Orientation(path) ? path : [...path].reverse();

/** Peças de uma árvore do Clipper: cada contorno externo com seus furos. */
function piecesOf(tree: ClipperLib.PolyNode): IntPiece[] {
  const out: IntPiece[] = [];
  const visit = (node: ClipperLib.PolyNode) => {
    for (const outer of node.Childs()) {
      out.push({
        outer: outer.Contour(),
        holes: outer.Childs().map((h) => h.Contour()),
      });
      for (const hole of outer.Childs()) visit(hole);
    }
  };
  visit(tree);
  return out;
}
const areaOf = (p: IntPiece) =>
  (Math.abs(ClipperLib.Clipper.Area(p.outer)) -
    p.holes.reduce((s, h) => s + Math.abs(ClipperLib.Clipper.Area(h)), 0)) /
  (PRECISION * PRECISION);
const flatPaths = (pieces: IntPiece[]) =>
  pieces.flatMap((p) => [p.outer, ...p.holes]);
const corner = (p: IntPiece) => [
  Math.min(...p.outer.map((q) => q.Y)),
  Math.min(...p.outer.map((q) => q.X)),
];

/** Região útil no referencial da tela: contorno encolhido menos aberturas crescidas. */
function usefulPieces(
  region: WeldedMeshRegion,
  frame: Frame,
  c: WeldedMeshCriteria,
): IntPiece[] {
  const offset = (paths: ClipperLib.Paths, delta: number) => {
    if (!delta || !paths.length) return paths;
    const co = new ClipperLib.ClipperOffset(2, 0.25);
    const out: ClipperLib.Paths = [];
    co.AddPaths(
      paths,
      ClipperLib.JoinType.jtMiter,
      ClipperLib.EndType.etClosedPolygon,
    );
    co.Execute(out, delta * PRECISION);
    return out;
  };
  const local = (pts: Point[]) =>
    positive(pts.map((p) => toInt(toLocal(frame, p))));
  const outers = offset([local(region.outer)], -c.edgeOffset);
  const openings = offset(region.openings.map(local), c.openingOffset);
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(outers, ClipperLib.PolyType.ptSubject, true);
  if (openings.length)
    clipper.AddPaths(openings, ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  clipper.Execute(
    ClipperLib.ClipType.ctDifference,
    tree,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return piecesOf(tree).filter((p) => areaOf(p) > AREA_EPS);
}

/**
 * Plano determinístico de painéis da tela escolhida sobre a região. Não altera
 * entradas; qualquer problema devolve diagnóstico sem plano parcial.
 */
export function planWeldedMeshLayout(
  region: WeldedMeshRegion,
  c: WeldedMeshCriteria,
  options: { anchor?: Point } = {},
): LayoutResult {
  const issues = weldedMeshCriteriaIssues(c);
  if (issues.length) return { ok: false, reason: issues.join(' ') };
  if (region.outer.length < 3)
    return { ok: false, reason: 'Região sem contorno válido.' };
  const mesh = c.mesh;
  const L = mesh.length,
    W = mesh.width,
    panelArea = L * W;
  const frame = frameOf(region.outer[0], c.orientation);
  const useful = usefulPieces(region, frame, c);
  const usefulArea = useful.reduce((s, p) => s + areaOf(p), 0);
  if (!(usefulArea > AREA_EPS))
    return {
      ok: false,
      reason:
        'Afastamentos eliminam a região: nenhum painel seria lançado. Reduza os afastamentos.',
    };

  // Grade: limites da região útil no referencial da tela.
  const xs = useful.flatMap((p) => p.outer.map((q) => q.X / PRECISION)),
    ys = useful.flatMap((p) => p.outer.map((q) => q.Y / PRECISION));
  const uMin = Math.min(...xs),
    uMax = Math.max(...xs),
    vMin = Math.min(...ys),
    vMax = Math.max(...ys);
  const right = c.start.endsWith('right'),
    top = c.start.startsWith('top');
  let ua = right ? uMax - L : uMin,
    va = top ? vMax - W : vMin;
  if (options.anchor) {
    const a = toLocal(frame, options.anchor);
    ua = a.x - (right ? L : 0);
    va = a.y - (top ? W : 0);
  }
  const stepU = L - c.lengthOverlap,
    stepV = W - c.widthOverlap;
  // Do último painel que começa até o início da região ao primeiro que termina
  // depois do fim dela. Com sobreposição, um painel antes do canto ainda encosta
  // na região, mas é redundante: o painel do canto já cobre aquele trecho.
  const iLo = Math.floor((uMin + EPS - ua) / stepU),
    iHi = Math.ceil((uMax - EPS - L - ua) / stepU),
    jLo = Math.floor((vMin + EPS - va) / stepV),
    jHi = Math.ceil((vMax - EPS - W - va) / stepV);
  const cells = (iHi - iLo + 1) * (jHi - jLo + 1);
  if (cells > LAYOUT_MAX_PANELS)
    return {
      ok: false,
      reason: `Região grande demais para a paginação: ${fmt(cells)} painéis na grade (limite de ${fmt(LAYOUT_MAX_PANELS)}). Divida a região em lançamentos menores.`,
    };

  const clip = flatPaths(useful);
  const toPoints = (path: ClipperLib.Path) =>
    path.map((q) => toModel(frame, fromInt(q)));
  const panels: LayoutPanel[] = [];
  for (let j = jLo; j <= jHi; j++)
    for (let i = iLo; i <= iHi; i++) {
      const u0 = ua + i * stepU,
        v0 = va + j * stepV;
      const rectLocal = [
        { x: u0, y: v0 },
        { x: u0 + L, y: v0 },
        { x: u0 + L, y: v0 + W },
        { x: u0, y: v0 + W },
      ];
      const clipper = new ClipperLib.Clipper();
      clipper.AddPath(
        rectLocal.map(toInt),
        ClipperLib.PolyType.ptSubject,
        true,
      );
      clipper.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
      const tree = new ClipperLib.PolyTree();
      clipper.Execute(
        ClipperLib.ClipType.ctIntersection,
        tree,
        ClipperLib.PolyFillType.pftNonZero,
        ClipperLib.PolyFillType.pftNonZero,
      );
      const pieces = piecesOf(tree)
        .filter((p) => areaOf(p) > AREA_EPS)
        .sort((a, b) => {
          const [ay, ax] = corner(a),
            [by, bx] = corner(b);
          return ay - by || ax - bx;
        })
        .map((p) => {
          const area = areaOf(p);
          return {
            outline: toPoints(p.outer),
            holes: p.holes.map(toPoints),
            area,
            cut: area < panelArea - AREA_EPS,
          };
        });
      if (!pieces.length) continue;
      panels.push({
        number: 0,
        row: top ? jHi - j : j - jLo,
        column: right ? iHi - i : i - iLo,
        rect: rectLocal.map((q) => toModel(frame, q)),
        local: { u: u0, v: v0 },
        pieces,
        appliedArea: pieces.reduce((s, p) => s + p.area, 0),
      });
    }
  panels.sort((a, b) => a.row - b.row || a.column - b.column);
  panels.forEach((p, k) => (p.number = k + 1));

  const appliedArea = panels.reduce((s, p) => s + p.appliedArea, 0);
  const basePanels = panels.length;
  const warnings: string[] = [];
  if (c.lengthOverlap === 0 && new Set(panels.map((p) => p.column)).size > 1)
    warnings.push(
      'Painéis vizinhos no comprimento sem sobreposição: a emenda entre eles não foi considerada.',
    );
  if (c.widthOverlap === 0 && new Set(panels.map((p) => p.row)).size > 1)
    warnings.push(
      'Painéis vizinhos na largura sem sobreposição: a emenda entre eles não foi considerada.',
    );
  return {
    ok: true,
    layout: {
      mesh: structuredClone(mesh),
      frame: { origin: { ...region.outer[0] }, orientation: c.orientation },
      useful: useful.map((p) => ({
        outline: toPoints(p.outer),
        holes: p.holes.map(toPoints),
      })),
      usefulArea,
      appliedArea,
      overlapArea: Math.max(0, appliedArea - usefulArea),
      wasteArea: Math.max(0, basePanels * panelArea - appliedArea),
      basePanels,
      fullPanels: panels.filter(
        (p) => p.pieces.length === 1 && !p.pieces[0].cut,
      ).length,
      cutPieces: panels.reduce(
        (s, p) => s + p.pieces.filter((q) => q.cut).length,
        0,
      ),
      appliedMass: (appliedArea / 1e6) * mesh.massPerArea,
      supplyMass: basePanels * mesh.massPerPanel,
      panels,
      assumptions: [
        'Paginação conservadora: cada painel da grade que toca a região útil conta como um painel-base, mesmo que gere peças separadas; não há reaproveitamento de retalhos entre painéis nem otimização de corte.',
        'Massa nominal aplicada = área de tela aplicada × massa por m²; massa de fornecimento = painéis-base × massa por painel. São valores nominais do cadastro, arredondados de forma independente; não são a massa exata dos fios recortados.',
        'Sobreposições e afastamentos são valores geométricos informados: não são traspasse nem cobrimento normativos.',
      ],
      warnings,
    },
  };
}

export type MeshWire = {
  kind: 'longitudinal' | 'transverse';
  /** mm */
  diameter: number;
  /** mm */
  spacing: number;
  /** Número do painel. */
  panel: number;
  a: Point;
  b: Point;
};

/**
 * Fios da malha para desenho: representação nominal, centrada no painel (não
 * representa a disposição comercial dos fios de borda) e recortada pelas
 * peças. Acima de `max` linhas devolve `simplified` sem fios; os quantitativos
 * nunca dependem dos fios desenhados.
 */
export function layoutWires(
  layout: WeldedMeshLayout,
  max = LAYOUT_MAX_WIRES,
): { simplified: boolean; wires: MeshWire[] } {
  const { mesh } = layout;
  const L = mesh.length,
    W = mesh.width;
  const count = (extent: number, spacing: number) =>
    Math.max(1, Math.floor(extent / spacing));
  const nLong = count(W, mesh.longitudinal.spacing),
    nTrans = count(L, mesh.transverse.spacing);
  if (layout.panels.length * (nLong + nTrans) > max)
    return { simplified: true, wires: [] };
  const positions = (extent: number, spacing: number, n: number) => {
    const margin = (extent - (n - 1) * spacing) / 2;
    return Array.from({ length: n }, (_, k) => margin + k * spacing);
  };
  const frame = frameOf(layout.frame.origin, layout.frame.orientation);
  const wires: MeshWire[] = [];
  for (const panel of layout.panels) {
    const { u: u0, v: v0 } = panel.local;
    const clip = panel.pieces.flatMap((piece) =>
      [piece.outline, ...piece.holes].map((path) =>
        path.map((p) => toInt(toLocal(frame, p))),
      ),
    );
    const run = (
      kind: MeshWire['kind'],
      lines: [Point, Point][],
      diameter: number,
      spacing: number,
    ) => {
      const clipper = new ClipperLib.Clipper();
      clipper.AddPaths(
        lines.map(([a, b]) => [toInt(a), toInt(b)]),
        ClipperLib.PolyType.ptSubject,
        false,
      );
      clipper.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
      const tree = new ClipperLib.PolyTree();
      clipper.Execute(
        ClipperLib.ClipType.ctIntersection,
        tree,
        ClipperLib.PolyFillType.pftNonZero,
        ClipperLib.PolyFillType.pftEvenOdd,
      );
      for (const path of ClipperLib.Clipper.OpenPathsFromPolyTree(tree)) {
        if (path.length < 2) continue;
        const a = toModel(frame, fromInt(path[0])),
          b = toModel(frame, fromInt(path[path.length - 1]));
        if (Math.hypot(b.x - a.x, b.y - a.y) < EPS) continue;
        wires.push({ kind, diameter, spacing, panel: panel.number, a, b });
      }
    };
    run(
      'longitudinal',
      positions(W, mesh.longitudinal.spacing, nLong).map((v) => [
        { x: u0, y: v0 + v },
        { x: u0 + L, y: v0 + v },
      ]),
      mesh.longitudinal.diameter,
      mesh.longitudinal.spacing,
    );
    run(
      'transverse',
      positions(L, mesh.transverse.spacing, nTrans).map((u) => [
        { x: u0 + u, y: v0 },
        { x: u0 + u, y: v0 + W },
      ]),
      mesh.transverse.diameter,
      mesh.transverse.spacing,
    );
    if (wires.length > max) return { simplified: true, wires: [] };
  }
  return { simplified: false, wires };
}
