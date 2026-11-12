import { readFile, writeFile } from 'node:fs/promises';
const root = 'docs/performance/render148';
const read = (name) =>
  readFile(`${root}/${name}.json`, 'utf8').then(JSON.parse);
const median = (a) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(1).replace('.', ',') : '—');
const representative = await read('armadura-representative');
const rows = [];
let md =
  'Os valores seguintes são **[M]**, em ms. Mediana das medianas e mediana dos p95 das três repetições; long tasks são a soma das contagens, não uma duração somada.\n\n';
md +=
  '**Cena representativa do ArmaduraStruct** (800 objetos físicos/gráficos com e sem a máscara):\n\n| Cena | Ação | Frame mediano | p95 frame | p95 proxy 2 frames | Long tasks (3 rep.) | Tarefas main thread / rep. |\n| --- | --- | --- | --- | --- | --- | --- |\n';
for (const [scene, s] of Object.entries(representative.scenes))
  for (const [action, runs] of Object.entries(s.actions)) {
    const r = {
      scene,
      action,
      median: median(runs.map((r) => r.frameMs.median)),
      p95: median(runs.map((r) => r.frameMs.p95)),
      inputP95: median(runs.map((r) => r.inputToTwoFramesMs.p95)),
      longTasks: runs.reduce((s, r) => s + r.longTasks.count, 0),
      taskMs: median(runs.map((r) => r.cpuMs.TaskDuration)),
      scriptMs: median(runs.map((r) => r.cpuMs.ScriptDuration)),
    };
    rows.push(r);
    md += `| ${scene} | ${action} | ${fmt(r.median)} | ${fmt(r.p95)} | ${fmt(r.inputP95)} | ${r.longTasks} | ${fmt(r.taskMs)} |\n`;
  }
md +=
  '\nA máscara adiciona só **dois nós** ao SVG (5.125 → 5.127), mas amplia muito o custo do caso representativo. Isso refuta uma explicação baseada apenas em quantidade de nós DOM. No perfil V8 do primeiro pan grande, `(program)` responde por cerca de 12 s e ScriptDuration fica abaixo de 100 ms por repetição; `(program)` não nomeia Paint/Raster. A hipótese de custo de pintura/composição exige a evidência de tracing complementar, não apenas essa categoria.\n\n';
const as = await read('common-armadura'),
  cc = await read('common-cadcraft');
const common = [];
md +=
  '**Mesmo DXF de linhas, aplicações completas** (não um ranking de GPU física; canvases, grid/estilos e caminhos de entrada próprios):\n\n| Aplicação | Linhas | Ação | Frame mediano | p95 frame | p95 proxy 2 frames | Long tasks (3 rep.) |\n| --- | --- | --- | --- | --- | --- | --- |\n';
for (const r of [...as.runs, ...cc.runs])
  for (const [action, runs] of Object.entries(r.actions)) {
    const v = {
      app: r.app,
      scene: r.scene,
      action,
      median: median(runs.map((r) => r.frameMs.median)),
      p95: median(runs.map((r) => r.frameMs.p95)),
      inputP95: median(runs.map((r) => r.inputToTwoFramesMs.p95)),
      longTasks: runs.reduce((s, r) => s + r.longTasks.count, 0),
    };
    common.push(v);
    md += `| ${r.app} | ${as.fixtures[r.scene].primitives} | ${action} | ${fmt(v.median)} | ${fmt(v.p95)} | ${fmt(v.inputP95)} | ${v.longTasks} |\n`;
  }
md +=
  '\n**Abertura e memória parcial**, uma observação por cena (não medianas de três aberturas):\n\n| Aplicação/cena | Proxy abertura até ready (ms) | Build/mesh interno (ms) | V8 usado (MiB) | Backing storage CDP (MiB) | Canvas útil (CSS px) |\n| --- | --- | --- | --- | --- | --- |\n';
for (const r of [...as.runs, ...cc.runs].filter((r) =>
  ['small', 'medium', 'large'].includes(r.scene),
)) {
  const perf = r.inspect.ui?.perf;
  md += `| ${r.app}/${r.scene} | ${fmt(r.openToReadyProxyMs)} | ${perf ? `${fmt(perf.buildMs)} / ${fmt(perf.meshMs)}` : 'não instrumentado'} | ${fmt(r.heap.usedSize / 1048576)} | ${fmt(r.heap.backingStorageSize / 1048576)} | ${r.canvas.width} × ${r.canvas.height} |\n`;
}
md +=
  '\n**Não comparar os heaps como memória total das aplicações:** estruturas Rust/WASM e recursos de driver não são medidos pelo heap V8. Os contadores internos CADCraft medem preparação/enfileiramento na CPU, não conclusão física da GPU. O resultado muito lento do caminho wgpu neste ambiente não demonstra superioridade de SVG em hardware: [snapshot de processos](performance/render148/software-process-snapshot.json) registra cerca de 193% de CPU média acumulada no processo gráfico por software, enquanto o canvas reporta `renderer: gpu`.\n\n';
md +=
  'Dados brutos: [representativa](performance/render148/armadura-representative.json), [comum AS](performance/render148/common-armadura.json), [comum CADCraft](performance/render148/common-cadcraft.json). Arrays de frames/eventos e long tasks estão nos arquivos comuns; o benchmark representativo guarda estatísticas por repetição e resumo do perfil, não um perfil V8 completo. Os três DXFs comuns foram carregados sem exceção JavaScript, e o CADCraft confirmou 100, 2.000 e 20.000 entidades/primitivas, sem truncamento.\n';
await writeFile(
  `${root}/summary.json`,
  JSON.stringify({ representative: rows, common }, null, 2) + '\n',
);
const file = 'docs/ANALISE-RENDERIZADOR-CAD.md',
  report = await readFile(file, 'utf8');
const start = report.indexOf('<!-- RESULTADOS-GERADOS -->'),
  end = report.includes('<!-- /RESULTADOS-GERADOS -->')
    ? report.indexOf('<!-- /RESULTADOS-GERADOS -->') +
      '<!-- /RESULTADOS-GERADOS -->'.length
    : report.indexOf('### 4.4');
if (start < 0 || end < 0) throw Error('Report markers missing');
await writeFile(
  file,
  report.slice(0, start) +
    '<!-- RESULTADOS-GERADOS -->\n\n' +
    md +
    '\n<!-- /RESULTADOS-GERADOS -->\n\n' +
    report.slice(end),
);
