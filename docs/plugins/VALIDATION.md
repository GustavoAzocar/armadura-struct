# Validação da infraestrutura v1 — 10/11/2026

- TypeScript, build Vite, formatação e suíte completa de domínio executados localmente.
- 11 testes de contratos/adaptador verificam schemas/tipos, exemplos negativos,
  negociação JSON-RPC, parâmetros, arquivo de exemplo, rejeição de saída, contexto,
  cancelamento/prazo, layers, transação atômica e proveniência nativa AS-09 com CSV/DXF.
- 9 testes Rust usam filesystem real em diretório temporário: inspeção de arquivo,
  reabertura/listagem/remoção offline, identidade/hash, conflito, concorrência entre
  serviços, staging interrompido, falha de armazenamento, corrupção de metadados,
  ZIP malformado/perigoso/expansão/duplicatas/links, schema e compatibilidade.
- O mesmo núcleo é exercitado contra servidor HTTP loopback controlado, com
  catálogo → download → inspeção → confirmação → registro, incluindo cancelamento,
  integridade divergente, redirect recusado e política pública de fontes.
- A ponte Tauri passou por cargo check local no Linux com bibliotecas de desenvolvimento
  isoladas. Ela também é compilada em CI Linux/Windows, junto ao aplicativo. Não há
  execução de pacotes de terceiros, instalador de plugin externo ou marketplace.
- Quatro E2E pertinentes estão em tests/e2e/plugins.spec.ts e rodam no CI: web,
  inspeção/confirmação/inventário/remoção via fixture IPC, consulta passiva/download,
  erro/cancelamento e foco/teclado. São provas da UI/contrato IPC, distintas dos
  testes nativos reais. Evidências de tela são artefatos plugins-evidence do CI.

O Chromium local deste ambiente falhou antes de interagir com qualquer controle
por bloqueio de renderização/frame; isso não é apresentado como E2E aprovado.
O CI do commit é a referência para resultados e evidências de navegador.
