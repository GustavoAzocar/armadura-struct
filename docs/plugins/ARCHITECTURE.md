# Decisão: contratos abertos, pacotes inertes e uma única instalação

A plataforma v1 separa contratos JSON públicos, domínio de conformidade TS,
serviço nativo openstruct-plugins, IPC Tauri estreito e interface transitória.
Não reutiliza inventário, assinatura ou catálogos de produtos como se fossem plugins.
Reutiliza diálogos nativos, diretório de dados Tauri e a API pública de armaduras,
com AS-09/AS-08 na fronteira de intercâmbio/proveniência. Não amplia capabilities,
CSP nem permissões de filesystem/shell do frontend.

O pacote é um ZIP portátil restrito, armazenado inteiro sem extração. Limites e
cabeçalhos centrais/locais são conferidos antes de descomprimir; a biblioteca ZIP
verifica CRC e o manifesto cobre cada carga com SHA-256. O parser estrito recusa
chaves JSON duplicadas. Toda extensão fica sem execução, inclusive runtime conhecido
ou desconhecido, pois autenticação/isolamento não são entregues por este registro.

Offline: diálogo nativo → validação → staging temporário → token de inspeção →
confirmação explícita → revalidação → lock de inventário → staging com pacote/recibo
sincronizados → rename atômico. A listagem deriva somente dos diretórios confirmados
installed/ID/versão. Mesmo conteúdo é idempotente, conflito não sobrescreve; versões
coexistem. Remoção usa identidade validada e rename para .trash. Staging/trash de
uma interrupção não entram no inventário. Erros de corrupção são explícitos;
limpeza automática de órfãos antigos é uma melhoria futura, sem afetar projetos.

Online: fonte configurável → catálogo limitado validado → ofertas opacas → download
HTTPS com DNS público fixado/sem redirects/mesma origem → hash e manifesto exatos →
mesmo staging/inspeção/instalador offline. Consultar ou baixar não confirma registro.
Cancelamento é cooperativo em DNS/request/stream; um resultado retornado após fechar
é descartado pela UI. Instalação/remoção atômicas não oferecem cancelamento enganoso.

JSON-RPC 2.0 desacopla transporte de contrato. A negociação descreve runtimes vazios
e execução indisponível. O exemplo estático em conformidade valida parâmetros e
saída pela API real, prévia e aplicação atômica com confirmação; não registra uma
engine de código de terceiros. AS-09 é uma saída identificada reservada, com o
adaptador de execução ainda não implementado. Não há ativação, atualização ou
regeneração em produção. O contrato de proveniência usa metadados existentes e
não exige migração de projeto nem presença do plugin para abrir/exportar geometria.

Validação: testes Rust usam diretório temporário real, concorrência entre serviços,
failure injection e servidor HTTP loopback restrito a cfg(test). Testes TS cobrem
contratos e domínio real. E2E testa a interface/IPC simulado; não é prova de execução
de instalador nativo. CI Linux/Windows compila a integração Tauri e executa o núcleo
nativo de plugins. Consultar docs/plugins/VALIDATION.md para os resultados desta entrega.
