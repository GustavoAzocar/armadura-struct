import { describe, expect, it } from 'vitest';
import {
  WELDED_MESH_CATALOG,
  catalogWeldedMesh,
  customWeldedMesh,
  defaultWeldedMeshCriteria,
  formatSteelArea,
  lengthToMm,
  weldedMeshCriteriaIssues,
  weldedMeshIssues,
  weldedMeshLabel,
  type WeldedMeshDefinition,
} from '../src/domain/weldedMesh';

/**
 * Tabela da issue #121, literal, nas unidades dela:
 * designação, espaçamento (cm), bitola (mm), As (cm²/m), kg/m², kg/painel.
 */
const ISSUE_TABLE: [string, number, number, number, number, number][] = [
  ['Q61', 15, 3.4, 0.61, 0.97, 14.3],
  ['Q75', 15, 3.8, 0.75, 1.21, 17.8],
  ['Q92', 15, 4.2, 0.92, 1.48, 21.8],
  ['Q113', 10, 3.8, 1.13, 1.8, 26.4],
  ['Q138', 10, 4.2, 1.38, 2.2, 32.3],
  ['EQ158', 15, 5.5, 1.58, 2.54, 37.3],
  ['Q166', 10, 4.6, 1.66, 2.63, 38.7],
  ['Q196', 10, 5.0, 1.96, 3.11, 45.8],
  ['Q238', 10, 5.5, 2.38, 3.77, 55.4],
  ['EQ257', 15, 7.0, 2.57, 4.11, 60.4],
  ['Q283', 10, 6.0, 2.83, 4.48, 65.9],
  ['Q335', 15, 8.0, 3.35, 5.37, 78.9],
  ['Q385', 10, 7.0, 3.85, 6.1, 89.7],
  ['EQ473', 15, 9.5, 4.73, 7.57, 111.3],
  ['Q503', 10, 8.0, 5.03, 7.97, 117.2],
  ['EQ591', 12, 9.5, 5.91, 9.41, 138.3],
  ['Q709', 10, 9.5, 7.09, 11.24, 165.3],
  ['Q785', 10, 10.0, 7.85, 12.46, 183.1],
];

const q92 = () => catalogWeldedMesh('Q92')!;

describe('Catálogo inicial de telas soldadas', () => {
  it('tem os 18 modelos da issue, na ordem, CA-60, painel 2,45 × 6,00 m', () => {
    expect(WELDED_MESH_CATALOG.map((m) => m.designation)).toEqual(
      ISSUE_TABLE.map((r) => r[0]),
    );
    for (const m of WELDED_MESH_CATALOG) {
      expect(m.steel).toBe('CA-60');
      expect(m.source).toBe('catalog');
      expect(m.presentation).toBe('panel');
      expect(m.length).toBe(6000);
      expect(m.width).toBe(2450);
      expect(weldedMeshIssues(m)).toEqual([]);
    }
  });

  it('cada linha confere com a tabela, convertida para mm e mm²/m nas duas direções', () => {
    for (const [
      name,
      spacingCm,
      diameter,
      areaCm2,
      kgM2,
      kgPanel,
    ] of ISSUE_TABLE) {
      const m = catalogWeldedMesh(name)!;
      for (const d of [m.longitudinal, m.transverse]) {
        expect(d.spacing).toBeCloseTo(lengthToMm(spacingCm, 'cm'), 9);
        expect(d.diameter).toBe(diameter);
        expect(d.steelArea).toBeCloseTo(areaCm2 * 100, 9);
      }
      expect(m.massPerArea).toBe(kgM2);
      expect(m.massPerPanel).toBe(kgPanel);
    }
  });

  it('Q92: identificação estável e valores exatos do cadastro (sem recalcular)', () => {
    const m = q92();
    expect(m.id).toBe('catalog:Q92');
    expect(m.family).toBe('Q');
    expect(m.longitudinal).toEqual({
      diameter: 4.2,
      spacing: 150,
      steelArea: 92,
    });
    expect(m.transverse).toEqual({
      diameter: 4.2,
      spacing: 150,
      steelArea: 92,
    });
    expect(m.massPerArea).toBe(1.48);
    expect(m.massPerPanel).toBe(21.8);
    expect(catalogWeldedMesh('EQ591')!.family).toBe('EQ');
    expect(catalogWeldedMesh('EQ591')!.longitudinal.spacing).toBe(120);
    expect(new Set(WELDED_MESH_CATALOG.map((m) => m.id)).size).toBe(18);
    expect(catalogWeldedMesh('Q999')).toBeUndefined();
  });

  it('o catálogo é imutável: a cópia entregue pode mudar sem afetar o cadastro', () => {
    expect(Object.isFrozen(WELDED_MESH_CATALOG)).toBe(true);
    const copy = q92();
    copy.massPerArea = 99;
    copy.longitudinal.diameter = 99;
    expect(q92().massPerArea).toBe(1.48);
    expect(q92().longitudinal.diameter).toBe(4.2);
  });
});

describe('Unidades e apresentação', () => {
  it('converte mm, cm e m para mm', () => {
    expect(lengthToMm(15, 'cm')).toBe(150);
    expect(lengthToMm(2.45, 'm')).toBeCloseTo(2450, 9);
    expect(lengthToMm(4.2, 'mm')).toBe(4.2);
  });

  it('área de aço exibida no convencional cm²/m (guardada em mm²/m)', () => {
    expect(formatSteelArea(92)).toBe('0,92 cm²/m');
    expect(formatSteelArea(785)).toBe('7,85 cm²/m');
    expect(formatSteelArea(61)).toBe('0,61 cm²/m');
  });

  it('rótulo distingue modelo do catálogo de configuração personalizada', () => {
    expect(weldedMeshLabel(q92())).toBe('Q92');
    const custom = customWeldedMesh(q92(), { massPerArea: 1.5 }, 'custom:1');
    expect(weldedMeshLabel(custom)).toBe('Q92 (personalizada)');
  });
});

describe('Definição de tela: validação', () => {
  const broken = (patch: Partial<WeldedMeshDefinition>) =>
    customWeldedMesh(q92(), patch, 'custom:t');

  it('aceita modelo personalizado assimétrico, claramente identificado', () => {
    const m = customWeldedMesh(
      q92(),
      {
        designation: 'R-teste',
        family: 'R',
        transverse: { diameter: 3.4, spacing: 300, steelArea: 30 },
      },
      'custom:r',
    );
    expect(m.source).toBe('custom');
    expect(m.id).toBe('custom:r');
    expect(m.longitudinal.diameter).toBe(4.2);
    expect(m.transverse.diameter).toBe(3.4);
    expect(weldedMeshIssues(m)).toEqual([]);
  });

  it('recusa valores editados apresentados como modelo do catálogo', () => {
    const fake = { ...q92(), massPerArea: 1.6 };
    expect(weldedMeshIssues(fake).join(' ')).toContain('catálogo');
  });

  it('bitolas, espaçamentos, áreas e dimensões positivos e finitos; massas não negativas', () => {
    const cases: Partial<WeldedMeshDefinition>[] = [
      { longitudinal: { diameter: 0, spacing: 150, steelArea: 92 } },
      { transverse: { diameter: 4.2, spacing: -1, steelArea: 92 } },
      { transverse: { diameter: 4.2, spacing: 150, steelArea: NaN } },
      { length: Infinity },
      { width: 0 },
      { massPerArea: -0.1 },
      { massPerPanel: -1 },
    ];
    for (const c of cases) expect(weldedMeshIssues(broken(c))).not.toEqual([]);
    expect(
      weldedMeshIssues(broken({ massPerArea: 0, massPerPanel: 0 })),
    ).toEqual([]);
  });

  it('longitudinal é a maior dimensão: comprimento menor que a largura é recusado', () => {
    const issues = weldedMeshIssues(broken({ length: 2000, width: 2450 }));
    expect(issues.join(' ')).toContain('maior dimensão');
    // Painel "deitado" é a mesma tela girada: a mensagem orienta a usar a orientação.
    expect(issues.join(' ')).toContain('orientação');
    expect(weldedMeshIssues(broken({ length: 2450, width: 2450 }))).toEqual([]);
  });
});

describe('Critérios de telas', () => {
  it('padrão: Q92 alinhada, sem afastamentos nem sobreposições, cópia independente', () => {
    const c = defaultWeldedMeshCriteria();
    expect(c.mesh).toEqual(q92());
    expect(c.orientation).toBe(0);
    expect(c.start).toBe('bottom-left');
    expect([
      c.edgeOffset,
      c.openingOffset,
      c.lengthOverlap,
      c.widthOverlap,
    ]).toEqual([0, 0, 0, 0]);
    expect(weldedMeshCriteriaIssues(c)).toEqual([]);
    c.mesh.massPerArea = 9;
    expect(defaultWeldedMeshCriteria().mesh.massPerArea).toBe(1.48);
  });

  it('sobreposição em cada eixo menor que a dimensão do painel naquele eixo', () => {
    const ok = {
      ...defaultWeldedMeshCriteria(),
      lengthOverlap: 300,
      widthOverlap: 150,
    };
    expect(weldedMeshCriteriaIssues(ok)).toEqual([]);
    const tooLong = { ...ok, lengthOverlap: 6000 };
    expect(weldedMeshCriteriaIssues(tooLong).join(' ')).toContain(
      'comprimento',
    );
    const tooWide = { ...ok, widthOverlap: 2450 };
    expect(weldedMeshCriteriaIssues(tooWide).join(' ')).toContain('largura');
  });

  it('afastamentos e sobreposições não negativos; orientação finita; tela inválida propaga', () => {
    const base = defaultWeldedMeshCriteria();
    for (const c of [
      { ...base, edgeOffset: -1 },
      { ...base, openingOffset: -5 },
      { ...base, widthOverlap: -1 },
      { ...base, orientation: NaN },
      { ...base, mark: '   ' },
      { ...base, mesh: { ...base.mesh, length: 0 } },
    ])
      expect(weldedMeshCriteriaIssues(c)).not.toEqual([]);
  });
});
