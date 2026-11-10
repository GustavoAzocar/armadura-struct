# Atualizações do ArmaduraStruct

## Decisão de arquitetura (antes da implementação)

Base conferida: ArmaduraStruct `2bf5424`, Launcher `4edd68a`, catálogo oficial assinado publicado em 09/11/2026, versão estável 0.5.0. Não há PR aberta implementando esta função nos dois repositórios.

Usar o catálogo e as assinaturas de pacotes existentes. Não criar feed Tauri próprio, alterar chaves nem usar `launcher/latest.json`. A consulta e o download ficam no backend Rust, mantendo a CSP sem acesso HTTP/shell genérico no frontend.

Reutilizar, como fonte vendorizada MIT fixada por SHA, os contratos, a validação Ed25519 e os adaptadores AppImage/NSIS do `launcher-core`. Isto permite compilar o repositório público sem credenciais para o repositório do Launcher. O subconjunto e as adaptações ficam documentados em `crates/openstruct-distribution/UPSTREAM.md`; outros aplicativos poderão consumir esse crate.

Instalações gerenciadas usam o mesmo `launcher.lock`, `DiskState`, marcador de propriedade, diretório, hash do executável, adaptador e inventário do Launcher. A atualização só prossegue com o Launcher fechado; não há IPC/deep link pré-existente presumido. O lock é adquirido antes de ler ou escrever o inventário e mantido até concluir. Não criar outro inventário de aplicativos. Outras instâncias/processos do produto impedem a instalação.

Instalações independentes: AppImage somente quando o arquivo realmente em execução é identificado por APPIMAGE e está em destino de usuário; Windows somente NSIS por usuário com registro de desinstalação correspondente ao executável atual. Instalações de sistema, formatos desconhecidos e builds de desenvolvimento recebem orientação e não executam instaladores. Web informa que não existe instalação desktop local.

O usuário primeiro autoriza o download da versão exibida. Depois da verificação, autoriza explicitamente instalar e reiniciar. O frontend protege o projeto e operações pendentes antes desta segunda ação. Um download web solicitado não equivale a salvar em disco.

Um helper, cópia privada do próprio executável com entrada CLI restrita, espera a liberação do processo original antes da instalação. Ele revalida pacote, destino e identidade, sem receber comandos/URLs do frontend. O estado local registra resultado/interrupção; o aplicativo reaberto confirma a versão efetivamente em execução. Iniciar o helper não é sucesso de instalação.

AppImage: substituir atomicamente, mantendo cópia anterior para recuperação. NSIS: usar o instalador assinado por usuário com `/UPDATE`, preservando dados, preferências de inicialização e atalhos; aguardar código de saída e confirmar o resultado no reinício. Não prometer rollback de NSIS ou de projetos. Nenhuma migração do schema de projeto faz parte desta entrega.

Consulta única após recuperação/interface prontas e ação manual coordenada, sem polling periódico. Timeout e limites de resposta/transferência, cancelamento durante download, catálogo assinado em cache e prevenção de regressão. Só conteúdo validado pode entrar no cache. Notas são texto, nunca HTML remoto.

## Validação e limites

Validação local em 10/11/2026: `npm run check` (666 testes de domínio/interface e 6 testes dos scripts de release), `npm run build`, `npm run format:check` e 28 testes Rust aprovados. O teste de instalador permanece ignorado por padrão e é executado somente no runner isolado após o build desktop. Chromium não pôde iniciar nesta bancada devido à restrição de sockets do ambiente; os testes de navegador são executados no CI.

Os checks e as capturas de cada commit ficam no [PR #108](https://github.com/ricardocorsini/armadura-struct/pull/108). O job de Linux gera DEB/AppImage; o de Windows gera NSIS. Ambos exercitam o pacote recém-compilado em instalações temporárias independentes e gerenciadas, incluindo a transação do inventário original, seus bloqueios e a preservação de outros registros/arquivos. O teste reinstala o pacote de teste; não simula a atualização gráfica entre duas releases diferentes.

Não executado: atualização completa entre releases publicadas com interação real de janelas, corte de energia, antivírus ou elevação pelo gerenciador do sistema. Builds, testes do adaptador e mocks não substituem essas verificações. Nenhuma release foi publicada ou instalação pessoal atualizada nesta tarefa.

## Uso

A consulta automática é única por sessão e começa depois da recuperação local. O aviso é passivo e não muda o foco do CAD. **Arquivo → Ajuda → Verificar atualizações** reabre a consulta e a oferta. **Agora não**, Esc e fechar o aviso não iniciam download, instalação ou reinício.

**Baixar versão X** autoriza somente a transferência. O progresso é calculado pelos bytes recebidos. O cancelamento está disponível durante o download, inclusive antes dos primeiros bytes; a verificação precisa terminar antes de prosseguir. **Instalar e reiniciar** exige marcar a autorização da versão apresentada e confirmar pelo botão. Com alterações pendentes, a ação é **Salvar, instalar e reiniciar**: cancelamento/falha do diálogo de salvamento impede o fechamento. Importações, exportações, comandos pendentes e gravações de pasta também impedem a instalação. IndexedDB continua sendo recuperação complementar, nunca prova de um arquivo salvo em disco.

No modo gerenciado, feche o Launcher e tente novamente se seu lock estiver ocupado. O atualizador valida a identidade e o hash da instalação antes de atualizar somente o registro `armadurastruct` no inventário original; os demais registros, preferências e campos são preservados. Não há um novo inventário paralelo. Não é necessário ter aberto o Launcher para consultar a versão ou iniciar o fluxo.

No AppImage independente, o arquivo continua no mesmo caminho; a cópia anterior fica ao lado com o sufixo `.openstruct-previous-<hash>`. Não sobrescrever um arquivo diferente que já exista nesse destino. Se a confirmação da nova versão falhar, o adaptador tenta restaurar a cópia anterior verificada. NSIS não tem rollback próprio: uma falha é registrada e o aplicativo é reaberto quando possível, sem prometer restauração dos arquivos do instalador.

Instalação de sistema/DEB, formato desconhecido e desenvolvimento não executam instaladores. A versão web informa que não há instalação nativa local. A oferta de pacote é restrita aos formatos existentes: NSIS por usuário no Windows e AppImage no Linux, atualmente x86_64. Não há suporte implícito a ARM, macOS, ZIP portátil Windows ou troca entre métodos.

## Segurança, publicação e recuperação

Nenhum endpoint, caminho de executável ou comando de shell é fornecido pelo frontend. O backend usa a versão Cargo realmente em execução, canal estável e origens HTTPS autorizadas, inclusive em cada redirecionamento. A assinatura do catálogo exige `catalog-v1`; essa chave não pode assinar pacotes. Os vetores e as assinaturas públicas existentes são conferidos em testes.

Consulta: timeout total de 20 segundos, limite de 3 MB de envelope e 2 MB de payload, uma tentativa automática e novas tentativas somente por ação manual (coordenadas, com limitação de cliques). Transferência: tamanho exato declarado, limite máximo do contrato de 2 GiB, timeout total de 30 minutos, limite de 30 segundos sem início/progresso e cancelamento durante espera/leitura. Antes do download há verificação conservadora de espaço livre no cache e no destino. Notas são texto escapado pelo React. Nenhum projeto, desenho, nome de usuário ou caminho local é enviado na consulta.

Cache e recibos ficam apenas na pasta local de atualizações de `com.openstruct.armadurastruct`. Um catálogo inválido não é usado como cache e um catálogo antigo é recusado. Falha de rede não significa "Atualizado". Os arquivos de download ficam em diretórios privados `stage-*`; uma nova tentativa limpa somente nomes produzidos pela operação e identificados por seu marcador, sem limpeza recursiva. A abertura seguinte informa o último resultado não confirmado/interrompido. Não há reinstalação automática após uma interrupção.

O helper verifica novamente o pacote e o destino, espera a saída do processo original e recusa outra instância do produto. O instalador tem de terminar com sucesso; um subprocesso sem interface consulta a versão do novo executável antes de atualizar o inventário. A aplicação reaberta confirma versão e localização. O helper nunca trata seu próprio início como instalação concluída. O processo nativo de instalação não oferece cancelamento forçado.

O publicador central, as tags imutáveis e as chaves permanecem como estão. **Não é necessário um feed Tauri novo.** Os próximos pacotes precisam incluir este código e o comando de consulta de identidade; pacotes antigos não ganham atualização interna retroativamente. Esta entrega não publica uma nova versão.

## Cobertura de testes

- TypeScript: coordenação, StrictMode, offline, repetição e modos sem instalador.
- Rust: SemVer, canal, plataforma, confiança, regressão, tamanho/hash/assinatura, locks, cópia anterior, colisões, restauração e confirmação de versão/localização.
- E2E: oferta passiva, texto seguro, confirmação separada, cancelamento, salvamento recusado/falho, modo web e janela baixa. O IPC é simulado; esses casos não provam um instalador real.
- CI desktop: compila os dois formatos e executa o adaptador nativo em diretório temporário isolado. O teste é ignorado por padrão e exige `CI=true` e autorização de sandbox de teste. Não usa uma instalação pessoal nem publica os pacotes.

A atualização completa entre duas releases publicadas, com janelas reais, e a recuperação diante de corte de energia/antivírus exigem validação adicional em máquinas de teste. O smoke test do adaptador e os testes de assinatura não substituem essa validação. A inspeção de outras instâncias tem os mesmos limites de acesso do Launcher; não é um serviço privilegiado.
