/** Reproducible, explicit reconstruction of these two reviewed example drawings.
 * This is not a generic DWG-to-rebar interpreter. Unknown CAD remains reference.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';
import { LibreDwg, Dwg_File_Type } from '@mlightcad/libredwg-web';
import { createServer } from 'vite';
const root = new URL('../../', import.meta.url);
const sourcePaths = process.argv.slice(2);
if (sourcePaths.length !== 2)
  throw Error(
    'Uso: npm run example:initial -- /caminho/vigas.dwg /caminho/pilares.dwg. Os DWGs fonte não são distribuídos no repositório.',
  );
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});
const engine = await LibreDwg.create(
  fileURLToPath(
    new URL(
      '../../node_modules/@mlightcad/libredwg-web/wasm/',
      import.meta.url,
    ),
  ),
);
const point = (p) => ({ x: p.x, y: p.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (p, k) => ({ x: p.x * k, y: p.y * k });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a, b) => a.x * b.y - a.y * b.x;
const id = (...args) => ['example', ...args].join(':');
function segment(e) {
  if (e.type === 'LINE')
    return { a: point(e.startPoint), b: point(e.endPoint), source: e };
  if (e.type !== 'ARC') throw Error(`Unexpected trace ${e.type}`);
  return {
    a: add(e.center, {
      x: e.radius * Math.cos(e.startAngle),
      y: e.radius * Math.sin(e.startAngle),
    }),
    b: add(e.center, {
      x: e.radius * Math.cos(e.endAngle),
      y: e.radius * Math.sin(e.endAngle),
    }),
    source: e,
  };
}
function chains(entities) {
  const out = [];
  for (const e of entities) {
    let s = segment(e),
      last = out.at(-1)?.at(-1)?.b;
    if (last && distance(last, s.b) < 1e-6) s = { ...s, a: s.b, b: s.a };
    if (!last || distance(last, s.a) > 1e-6) out.push([]);
    out.at(-1).push(s);
  }
  return out;
}
function vertices(chain, k) {
  const lines = chain.filter((s) => s.source.type === 'LINE');
  const out = [lines[0].a];
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i],
      b = lines[i + 1],
      u = sub(a.b, a.a),
      v = sub(b.b, b.a),
      den = cross(u, v);
    if (Math.abs(den) < 1e-10) {
      if (distance(a.b, b.a) > 1e-6) throw Error('Disconnected parallel trace');
      continue;
    }
    out.push(add(a.a, scale(u, cross(sub(b.a, a.a), v) / den)));
  }
  out.push(lines.at(-1).b);
  return out.map((p) => scale(sub(p, out[0]), k));
}
const summaries = {
  vigas: [
    ['CA-50', 6.3, 12.8, 3.4],
    ['CA-50', 8, 89.8, 39],
    ['CA-50', 10, 55, 37.3],
    ['CA-50', 12.5, 110.8, 117.5],
    ['CA-50', 16, 105.7, 183.6],
    ['CA-50', 20, 78.4, 212.7],
    ['CA-50', 25, 9.7, 41.3],
    ['CA-60', 5, 584.1, 99],
  ],
  pilares: [
    ['CA-50', 10, 115.8, 78.6],
    ['CA-50', 12.5, 31.7, 33.6],
    ['CA-50', 16, 153.8, 267],
    ['CA-60', 5, 301.6, 51.1],
  ],
};
try {
  const { emptyProject, decodeProject, schedule } = await server.ssrLoadModule(
    '/src/domain/model.ts',
  );
  const { normalizeCad } = await server.ssrLoadModule('/src/cad/import.ts');
  const { executeRebarBatch } = await server.ssrLoadModule(
    '/src/domain/rebarApi.ts',
  );
  const { geometry } = await server.ssrLoadModule('/src/domain/geometry.ts');
  const { composeSheet } = await server.ssrLoadModule('/src/domain/paper.ts');
  let project = emptyProject();
  project = {
    ...project,
    id: 'example:armadurastruct:1',
    name: 'Exemplo ArmaduraStruct',
    author: 'OpenStruct · Ricardo Corsini',
    notes:
      'Duas pranchas reconstruídas dos DWGs fornecidos: vigas V12–V26 e pilares P1, P7, P17 e P13. Armaduras editáveis; fôrmas, cotas e RA originais são referências CAD. Confira comprimentos desenvolvidos e massa em Conferir exemplo. O resumo original inclui 10%; o quadro nativo calcula massa líquida. Exemplo de detalhamento, sem dimensionamento estrutural.',
    bars: [],
    details: [],
    masks: [],
    annotations: [],
    polylines: [],
    fabricationPositions: [],
    sheets: [],
    hierarchy: {
      floors: [],
      elements: [],
      details: [],
      drawings: [],
      placements: [],
      objectDetails: {},
      objectOrigins: {},
    },
  };
  const audit = {
    id: project.id,
    version: 1,
    title: project.name,
    sources: [],
    positions: [],
  };
  const commands = [];
  const ensureDetail = (key, floor, element, name) => {
    const f = id('floor', floor),
      e = id('element', floor, element),
      d = id('detail', key);
    const h = project.hierarchy;
    if (!h.floors.some((x) => x.id === f))
      h.floors.push({ id: f, name: floor });
    if (!h.elements.some((x) => x.id === e))
      h.elements.push({ id: e, floorId: f, name: element });
    if (!h.details.some((x) => x.id === d)) {
      h.details.push({ id: d, elementId: e, name });
      h.drawings.push({ id: id('drawing', key), detailId: d, name });
    }
    return d;
  };
  for (const [sheetIndex, key] of ['vigas', 'pilares'].entries()) {
    const buffer = await readFile(sourcePaths[sheetIndex]);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const ptr = engine.dwg_read_data(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
      Dwg_File_Type.DWG,
    );
    if (!ptr) throw Error(`Cannot read ${key}`);
    const db = engine.convert(ptr);
    engine.dwg_free(ptr);
    const es = db.entities;
    const sheet = id('sheet', key),
      drawing = id('drawing', key),
      nativeDetail = ensureDetail(
        key,
        'Pranchas',
        'Composição',
        key === 'vigas' ? 'Prancha de vigas' : 'Prancha de pilares',
      );
    const modelScale = key === 'vigas' ? 500 : 250,
      offset = { x: sheetIndex * 65000, y: 0 };
    project.sheets.push({
      id: sheet,
      name: key === 'vigas' ? '01 · Vigas' : '02 · Pilares',
      format: 'A0',
      orientation: 'landscape',
      customSize: { width: 1189, height: 841 },
      margins: { left: 0, right: 0, top: 0, bottom: 0 },
      seal: { enabled: false, width: 180, height: 55 },
      properties: {
        revision: 'Exemplo 1',
        notes:
          'Referência original ao lado do modelo editável; confira divergências no relatório.',
      },
    });
    project.hierarchy.placements.push({
      id: id('view', key),
      sheetId: sheet,
      drawingId: drawing,
      origin: { x: 0, y: 0 },
      rotation: 0,
      scale: modelScale / 10,
      modelOrigin: offset,
      textHeight: 2,
      title: `${key === 'vigas' ? 'Vigas V12–V26' : 'Pilares P1 · P7 · P17 · P13'} · RA original de referência`,
      frame: { width: 1189, height: 841 },
    });
    const titles = es
      .filter((e) => e.layer === 'DT-Título' && e.type === 'MTEXT')
      .map((e) => ({ name: e.text, p: e.insertionPoint }));
    const locate = (caption) => {
      const p = caption.insertionPoint;
      if (key === 'vigas') {
        const row = titles
          .filter((t) => t.p.y >= p.y - 0.3)
          .sort((a, b) => a.p.y - b.p.y)[0]?.p.y;
        const title = titles
          .filter((t) => Math.abs(t.p.y - row) < 0.1 && t.p.x <= p.x + 0.4)
          .sort((a, b) => b.p.x - a.p.x)[0];
        if (!title) throw Error(`Cannot locate ${caption.handle}`);
        return {
          element: title.name,
          floor: 'Vigas · pavimento de referência',
          level: '',
        };
      }
      const title = titles
        .filter((t) => t.p.x <= p.x + 0.4)
        .sort((a, b) => b.p.x - a.p.x)[0];
      const floors = es.filter(
        (e) =>
          e.type === 'MTEXT' &&
          / - L\d+$/.test(e.text) &&
          e.insertionPoint.x >= title.p.x &&
          e.insertionPoint.x < title.p.x + 9,
      );
      const floor = floors
        .filter((e) => e.insertionPoint.y >= p.y - 0.3)
        .sort((a, b) => a.insertionPoint.y - b.insertionPoint.y)[0];
      if (!floor) throw Error(`Cannot locate floor ${caption.handle}`);
      const [name, level] = floor.text.split(' - ');
      return { element: title.name, floor: name, level };
    };
    const groups = [];
    let buf = [];
    const pending = new Map();
    for (const e of es) {
      if (e.layer === 'DT-Barras rebatidas') buf.push(e);
      const m = /^(?:(\d+)x)?(\d+) N(\d+) ø([\d.]+) C=(\d+)$/.exec(
        e.text ?? '',
      );
      if (!m) continue;
      const context = locate(e),
        originKey = context.element + context.level;
      const cs = chains(buf);
      buf = [];
      let chain;
      if (cs.length > 1) {
        pending.set(originKey, cs.slice(0, -1));
        chain = cs.at(-1);
      } else chain = cs[0];
      if (!chain) {
        chain = pending.get(originKey)?.shift();
      }
      if (!chain) throw Error(`No trace for ${key}/${e.handle}`);
      const n = Number(m[3]),
        plotScale =
          key === 'vigas'
            ? (Number(m[4]) === 5 && [1, 3, 5].includes(n)) || n === 23
              ? 250
              : 500
            : [1, 2, 3, 4].includes(n)
              ? 200
              : 250;
      groups.push({
        caption: e,
        quantity: Number(m[2]),
        multiplier: Number(m[1] ?? 1),
        sourceMark: `N${n}`,
        diameter: Number(m[4]),
        declaredLength: Number(m[5]) * 10,
        context,
        chain,
        plotScale,
      });
    }
    if (buf.length || [...pending.values()].some((a) => a.length))
      throw Error(`Unassigned rebar trace in ${key}`);
    const traceHandles = new Set(
        groups.flatMap((g) => g.chain.map((s) => s.source.handle)),
      ),
      captionHandles = new Set(groups.map((g) => g.caption.handle));
    const referenceDb = {
      ...db,
      entities: es.filter(
        (e) => !traceHandles.has(e.handle) && !captionHandles.has(e.handle),
      ),
    };
    const mask = normalizeCad(
      referenceDb,
      `${key === 'vigas' ? 'Vigas' : 'Pilares'} · fôrmas, cotas e RA originais (referência)`,
      'DWG',
    );
    mask.id = id('mask', key);
    mask.scale = modelScale;
    mask.origin = offset;
    mask.opacity = 0.9;
    mask.sourceUnit =
      'Composição CAD: 1 unidade = 10 mm no papel; escalas locais explícitas.';
    project.masks.push(mask);
    project.hierarchy.objectDetails[mask.id] = nativeDetail;
    const steelRows = es.filter(
      (e) =>
        e.layer === 'DT-Relação do aço' &&
        e.type === 'MTEXT' &&
        Math.abs(e.insertionPoint.x - 110.9696) < 0.02 &&
        /^\d+$/.test(e.text),
    );
    let currentSteel;
    for (const re of steelRows) {
      const cells = es
        .filter(
          (e) =>
            e.type === 'MTEXT' &&
            e.layer === 'DT-Relação do aço' &&
            Math.abs(e.insertionPoint.y - re.insertionPoint.y) < 0.01,
        )
        .sort((a, b) => a.insertionPoint.x - b.insertionPoint.x);
      if (![5, 6].includes(cells.length))
        throw Error(`RA row ${key}/${re.text} has ${cells.length} cells`);
      if (cells.length === 6) currentSteel = cells.shift().text;
      const steel = currentSteel;
      const [n, diam, qty, len, total] = cells.map((e) => e.text);
      const sourceMark = `N${n}`,
        members = groups.filter((g) => g.sourceMark === sourceMark);
      if (
        !members.length ||
        members.reduce((s, g) => s + g.quantity * g.multiplier, 0) !==
          Number(qty)
      )
        throw Error(`RA quantity mismatch ${key}/${sourceMark}`);
      audit.positions.push({
        key: `${key}:${sourceMark}`,
        sheetKey: key,
        sheetId: sheet,
        sourceMark,
        nativeMark: `${key === 'vigas' ? 'V' : 'P'}-${sourceMark}`,
        steel: steel === 'CA60' ? 'CA-60' : 'CA-50',
        diameter: Number(diam),
        quantity: Number(qty),
        cutLengthMm: Number(len) * 10,
        totalLengthMm: Number(total) * 10,
        sourceRowHandles: cells.map((e) => e.handle),
        occurrences: [],
      });
    }
    for (const [steel, diameter, lengthM, weightKg] of summaries[key]) {
      const diameterCell = es.find(
        (e) =>
          e.type === 'MTEXT' &&
          e.layer === 'DT-Relação do aço' &&
          Math.abs(e.insertionPoint.x - 111.605) < 0.01 &&
          Number(e.text) === diameter &&
          es.some(
            (t) =>
              t.type === 'MTEXT' &&
              t.layer === 'DT-Relação do aço' &&
              Math.abs(t.insertionPoint.y - e.insertionPoint.y) < 0.001 &&
              Math.abs(t.insertionPoint.x - 113.5112) < 0.01 &&
              Number(t.text) === lengthM,
          ),
      );
      if (
        !diameterCell ||
        !es.some(
          (e) =>
            e.type === 'MTEXT' &&
            e.layer === 'DT-Relação do aço' &&
            Math.abs(e.insertionPoint.x - 115.6292) < 0.01 &&
            Math.abs(e.insertionPoint.y - diameterCell.insertionPoint.y) <
              0.001 &&
            Number(e.text) === weightKg,
        )
      )
        throw Error(`Original summary mismatch ${key}/${steel}/${diameter}`);
    }
    const source = {
      key,
      file: key === 'vigas' ? 'Exemplo.dwg' : 'Exemplo - Pilar.dwg',
      sha256,
      plotUnitMm: 10,
      summaryAllowance: 0.1,
      summary: summaries[key].map(
        ([steel, diameter, totalLengthM, grossWeightKg]) => ({
          steel,
          diameter,
          totalLengthM,
          grossWeightKg,
        }),
      ),
      warnings: mask.warnings,
    };
    audit.sources.push(source);
    for (const g of groups) {
      const row = audit.positions.find(
        (r) => r.key === `${key}:${g.sourceMark}`,
      );
      if (!row || row.diameter !== g.diameter) throw Error('Diameter mismatch');
      const local = vertices(g.chain, g.plotScale),
        first = g.chain[0].a;
      const radii = [
        ...new Set(
          g.chain
            .filter((s) => s.source.type === 'ARC')
            .map((s) => s.source.radius.toFixed(9)),
        ),
      ];
      if (radii.length > 1)
        throw Error(`Varying mandrel ${key}/${g.caption.handle}`);
      const mandrel = radii.length
        ? 2 * Number(radii[0]) * g.plotScale - g.diameter
        : g.diameter * 5;
      if (mandrel <= 0) throw Error('Invalid mandrel');
      const barId = id('bar', key, g.caption.handle),
        detailId = ensureDetail(
          `${key}:${g.context.element}:${g.context.level}`,
          g.context.floor,
          g.context.element,
          g.context.level
            ? `${g.context.element} · ${g.context.level}`
            : `${g.context.element} · armaduras`,
        );
      commands.push({
        type: 'bar.create',
        id: barId,
        detailId,
        provenance: { projectId: `dwg:${sha256}`, objectId: g.caption.handle },
        definition: {
          kind: 'free',
          points: local,
          origin: add(offset, scale(first, modelScale)),
          mark: `${row.nativeMark}-${g.caption.handle}`,
          element: g.context.element,
          diameter: g.diameter,
          mandrel,
          steel: row.steel,
          quantity: g.quantity,
          multiplier: g.multiplier,
          quantitySource: { kind: 'manual' },
          color: '#3448d1',
          ...(g.context.level ? { columnLevel: g.context.level } : {}),
          comment: `${source.file} · ${g.context.element}${g.context.level ? ' / ' + g.context.level : ''} · ${g.sourceMark} · C original=${g.declaredLength / 10} cm. Traçado reconstruído; consultar conferência.`,
        },
      });
      const labelAngle =
        (Math.atan2(g.caption.direction.y, g.caption.direction.x) * 180) /
        Math.PI;
      commands.push({
        type: 'representation.create',
        id: id('representation', key, g.caption.handle),
        barId,
        detailId: nativeDetail,
        origin: add(offset, scale(first, modelScale)),
        scale: modelScale / g.plotScale,
        rotation: 0,
        identification: 'primary',
        showDimensions: false,
        label: {
          origin: scale(sub(g.caption.insertionPoint, first), g.plotScale),
          rotation: labelAngle,
          height: g.caption.textHeight * g.plotScale,
          omitPrefix: key === 'vigas' ? 'V-' : 'P-',
        },
      });
      row.occurrences.push({
        barId,
        captionHandle: g.caption.handle,
        element: g.context.element,
        floor: g.context.floor,
        level: g.context.level,
        plotScale: g.plotScale / 10,
        declaredCutLengthMm: g.declaredLength,
        traceHandles: g.chain.map((s) => s.source.handle),
      });
    }
  }
  for (const r of audit.positions) {
    const ids = r.occurrences.map((o) => o.barId);
    if (ids.length > 1)
      commands.push({
        type: 'fabrication.group',
        ids,
        representativeId: ids[0],
        mark: r.nativeMark,
      });
    else
      commands.push({
        type: 'bar.update',
        id: ids[0],
        patch: { kind: 'free', mark: r.nativeMark },
      });
  }
  const result = executeRebarBatch(project, commands, { units: 'mm' });
  if (!result.ok) throw Error(JSON.stringify(result.issues, null, 2));
  const generated = result.project;
  generated.fabricationPositions = audit.positions.map((r) => ({
    ...generated.fabricationPositions.find((p) => p.mark === r.nativeMark),
    id: id('position', r.sheetKey, r.sourceMark),
  }));
  project = decodeProject(JSON.stringify(generated));
  for (const r of schedule(project))
    if (r.errors.length) throw Error(`${r.mark}: ${r.errors}`);
  for (const s of project.sheets) {
    const p = composeSheet(project, s.id);
    if (p.issues.length) throw Error(`${s.name}: ${JSON.stringify(p.issues)}`);
  }
  const json = await format(JSON.stringify(project), { parser: 'json' });
  await writeFile(new URL('src/examples/initial.armstruct.json', root), json);
  await writeFile(
    new URL('src/examples/initial-reference.json', root),
    await format(JSON.stringify(audit), { parser: 'json' }),
  );
  console.log(
    JSON.stringify(
      {
        objects: project.bars.length,
        positions: project.fabricationPositions.length,
        sheets: project.sheets.length,
        bytes: json.length,
        weightKg: schedule(project).reduce((s, r) => s + r.weight, 0),
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
