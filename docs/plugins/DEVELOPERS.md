# Plugins ArmaduraStruct — contrato público v1

## O que esta versão entrega

ArmaduraStruct 0.6.0 registra pacotes .osplugin no desktop, permite inspecionar,
confirmar, listar após reabrir e remover offline. A aba Plugins também consulta
uma fonte de catálogo configurada pelo usuário e baixa um pacote para inspeção;
só a confirmação seguinte instala. Nenhum runtime de terceiros está habilitado.
Pacotes declarativos, Python, JavaScript, WASM ou outros são dados inertes;
registrá-los não concede permissões nem executa seus arquivos.

A loja pública, assinaturas verificadas, ativação, atualização, execução isolada,
pagamentos, upload e o detalhador real de estacas são etapas futuras. O catálogo
não tem uma fonte oficial padrão. Exemplos são de conformidade, não uma loja.

## Arquivos públicos e versões independentes

- public/plugins/v1/manifest.schema.json: manifesto openstruct.plugin/1.
- public/plugins/v1/catalog.schema.json: catálogo openstruct.plugin-catalog/1.
- public/plugins/v1/protocol.schema.json: envelopes JSON-RPC 2.0.
- public/plugins/v1/provenance.schema.json: proveniência em metadados AS-09.
- public/plugins/v1/types.ts: tipos independentes de React, Tauri e linguagem de execução.
- src/pluginApi.ts: fachada executável para ferramentas de conformidade do host.
- src/api.ts e docs/AS-51.md: API nativa de armaduras, fonte das operações válidas.
- examples/plugins/straight-bar: exemplo mínimo; os outros JSONs incluem casos negativos.

Versão do plugin é SemVer; versão da API de plugins é 1.0.0; o protocolo de
mensagens usa JSON-RPC 2.0; a API de armaduras é 1.0 (normalizada para 1.0.0 ao
comparar compatibilidade); a versão do aplicativo é independente. Não aumente
uma versão principal do protocolo por uma simples alteração de descrição.
Mudanças incompatíveis exigem novo major. Schemas /1 são fechados; extensões
adicionais devem ficar em extensions, com chave de namespace próprio.

As faixas de compatibilidade usam intervalos explícitos, independentes da sintaxe
de ranges de ferramentas: {"min":"1.0.0","maxExclusive":"2.0.0"} significa

> =1.0.0 e <2.0.0. Limites devem ser estáveis, min < maxExclusive. Hosts prerelease
> não são elegíveis nesta versão. Capacidades obrigatórias desconhecidas impedem
> registro. Opcionais desconhecidas são ignoradas e exibidas na inspeção.

## Criar uma extensão

1. Use um ID estável com namespace sob seu controle, por exemplo
   br.suaempresa.detalhes-estacas. Nome, editor, licença e links são metadados
   declarados. O ID do editor identifica uma entidade diferente do ID do plugin;
   nenhum desses campos comprova autoria. Não reutilize IDs de outros autores.
2. Copie examples/plugins/straight-bar/manifest.json e ajuste nome, descrição,
   publisher, versão, licença, links e compatibilidade. host._, tauri._,
   armadurastruct._ e openstruct.host._ são namespaces reservados do host.
3. Declare plataformas (linux, windows, macos) e arquiteturas (x86_64, aarch64).
   any deve aparecer sozinho e significa conteúdo universal naquela dimensão.
4. Declare runtime.kind e, se houver arquivo de entrada, runtime.entry. A entrada
   deve constar em files. Todos os runtimes permanecem sem execução nesta etapa;
   desconhecido não significa permitido. Não há scripts de pós-instalação.
5. Declare capacidades required/optional e permissões solicitadas. As capacidades
   host.inspect e rebar.batch.v1 descrevem inspeção e o adaptador de conformidade;
   não habilitam execução. Permissões possíveis são context.read, rebar.preview,
   detail.preview, network, filesystem, shell. Nenhuma é concedida nesta versão.
6. Declare geradores com IDs únicos locais, inputSchema e uma saída identificada.
   O primeiro adaptador de conformidade suporta rebar-batch/1. openstruct.detail/16
   reserva um adaptador AS-09 separado; sua execução por plugin ainda não existe.
7. Liste em files cada arquivo de carga, com tamanho e SHA-256. Não inclua o
   próprio manifest.json nessa lista. O empacotador abaixo calcula esses campos.

inputSchema é um subconjunto de JSON Schema draft-07, adequado a formulários:
object/properties/required/additionalProperties (booleano), array/items e limites,
number/integer com minimum/maximum, string com limites, boolean e enum de valores
simples. x-unit pode ser mm, deg, count ou none. Estruturas podem ser compostas;
referências, padrões executáveis, schemas externos e fórmulas não fazem parte
registrável do contrato. A ferramenta valida o próprio schema e os parâmetros.
Não é necessário importar componentes internos nem construir um formulário React.

Um gerador deve receber somente parâmetros validados e contexto autorizado,
com unidades explícitas. Ele devolve JSON, sem referências mutáveis ao projeto.
Use as famílias reais da API: free e stirrup, incluindo perfis suportados; não
anuncie geometria helicoidal/estaca que ainda não exista no domínio. Armaduras
são posições nativas; primitivas auxiliares não substituem quantitativos.

## Validar e empacotar

No checkout do repositório, com Node >=22.12 e npm ci executado:

    npm run plugins:validate -- examples/plugins/straight-bar/manifest.json
    npm run plugins:pack -- examples/plugins/straight-bar/manifest.json meu-plugin.osplugin
    npm run plugins:validate -- meu-plugin.osplugin

A validação informa identidade, hash, elegibilidade para o host atual e execução
desativada. Um manifesto estruturalmente válido pode ser incompatível com o host;
leia compatibility.compatible. O runtime futuro é válido para registro desativado,
mas um required desconhecido ou uma plataforma incompatível não é instalável.
A validação nativa de instalação é a fronteira final, incluindo chaves JSON
ambíguas, CRC do ZIP e revalidação na confirmação. Ferramentas independentes podem
usar os schemas JSON; as verificações semânticas, limites e ZIP também se aplicam.

Os comandos e a demonstração da API são código do repositório usado por testes,
não runtime carregado do pacote. docs/plugins/demo.ts gera uma barra reta
com parâmetros length (mm) e quantity, como teste da fronteira pública.

## Formato portátil .osplugin

Contêiner ZIP com manifest.json UTF-8 na raiz. O subconjunto v1 usa entradas de
arquivos (sem entradas de diretórios), Stored ou Deflate, sem criptografia,
ZIP64, multi-volume, comentários, campos extra ou data descriptors. As entradas
locais e centrais devem estar na mesma ordem e corresponder exatamente. Isso
remove ambiguidades entre plataformas e ferramentas; o empacotador gera o formato.

Limites: arquivo do pacote 16 MiB; expansão total 64 MiB; até 256 arquivos;
cada arquivo até 16 MiB; razão de expansão até 100:1; manifesto até 128 KiB;
JSON até 24 níveis; catálogo até 2 MiB, 128 versões e 16 artefatos por versão.
Parâmetros de geração até 4 KiB; saída de conformidade até 4 MiB e 10000 operações. Proveniência AS-09 até 5000 caracteres.

Caminhos são relativos, ASCII, até 160 caracteres, com / como separador e segmentos
formados por letras, números, \_, - e pontos entre nomes. Recusam-se caminhos
absolutos, .., barras invertidas, nomes Windows reservados e **proto**, links, tipos especiais,
colisões de caixa, entradas duplicadas, sobreposição de dados e arquivos não
listados. O host verifica tamanho, CRC e SHA-256 antes de registrar. Os arquivos
ficam no ZIP inerte; não são extraídos nem tratados como código, HTML ou ícones.

## Distribuir offline

Entregue o mesmo .osplugin versionado por arquivo. O usuário abre Plugins →
Instalar offline → Selecionar pacote .osplugin. A inspeção apresenta identidade,
editor declarado, versão, compatibilidade, origem, capacidades, permissões e hash.
Confirmar instalação desativada registra na área de dados do usuário do desktop.

O inventário é separado dos projetos e pode ser listado/removido sem internet.
Instalações usam staging, lock entre processos e rename atômico do diretório
contendo pacote + recibo; a listagem considera apenas diretórios confirmados.
Interrupções deixam staging invisível e preservam versões anteriores. Mesmo
ID/versão/hash é idempotente; conteúdo diferente com o mesmo ID/versão é recusado.
Versões diferentes coexistem, sem ação de atualização/ativação nesta entrega.
Confirmações usam tokens opacos por sessão, válidos por até 10 minutos. Uma
inspeção cancelada/expirada deve ser refeita. Até quatro inspeções simultâneas.

Remover uma versão usa a identidade validada do inventário, move para descarte e
remove somente arquivos de plugin. Os projetos e detalhes gerados não são removidos.
Pacotes instalados incompatíveis com uma versão futura do host continuam visíveis
com o estado correspondente e sem execução. Não há fallback de runtime.

## Preparar a futura loja e submeter

1. Valide o manifesto, parâmetros e saída com as ferramentas e testes públicos.
2. Empacote, confira o SHA-256 final do .osplugin e publique um artefato imutável,
   versionado, em domínio HTTPS público sob controle do distribuidor.
3. Prepare uma entrada de catálogo conforme catalog.schema.json. Ela inclui o
   manifesto completo e artifacts com URL, bytes, SHA-256, plataforma, arquitetura
   e runtime. Os valores devem corresponder ao manifesto e ao arquivo real.
4. Submeta esses metadados para revisão, por exemplo por PR ao catálogo escolhido.
   Qualquer desenvolvedor pode submeter. Submissão não implica publicação,
   aprovação automática, confiança ou execução. Não existe portal oficial agora.
5. Ao publicar nova versão, preserve ID, incremente SemVer e mantenha ranges,
   permissões e artefatos atualizados. Não substitua bytes de uma versão já publicada.

A fonte precisa servir catálogo e pacotes na mesma origem HTTPS pública, porta
443, sem autenticação, query, fragmento ou redirecionamentos. O downloader valida
DNS público, fixa os endereços verificados na conexão, bloqueia IP privado/reservado,
limita bytes e tempo. Não embuta tokens ou chaves. Catálogos hospedados em URLs que
redirecionam não são elegíveis nesta etapa. Use um domínio/CDN que sirva diretamente.

O schema aceita HTTP para fixtures; somente os testes nativos têm adaptador
loopback HTTP. O aplicativo de produção sempre exige a política HTTPS pública.
examples/plugins/catalog.fixture.json não é uma fonte oficial e não é consultado
automaticamente. Testes nativos usam servidor temporário local e bytes reais.
A UI do navegador explica as limitações; não simula instalação persistente.

## Comunicação e negociação (sem transporte imposto)

JSON-RPC 2.0 foi escolhido para correlação e erros interoperáveis. Não há servidor
HTTP, porta aberta ou transporte de execução implícito. Tipos, envelopes e
pluginHostRequest estão disponíveis para conformidade e futuros adaptadores.

Requisição de negociação:

    {"jsonrpc":"2.0","id":"init-1","method":"plugin.initialize","params":{"protocolVersion":"1.0.0"}}

O resultado informa protocolVersion, rebarApiVersion, capacidades, famílias reais,
outputAdapters, reservedOutputs, runtimes:[] e executionEnabled:false. O método
plugin.capabilities também consulta esses dados. plugin.generate retorna -32010
(runtime não implementado). Versão incompatível: -32001; mensagem inválida:
-32600; método desconhecido: -32601; parâmetros inválidos: -32602; capacidade
obrigatória desconhecida na negociação: -32004. requiredCapabilities e
optionalCapabilities são opcionais na negociação (até 128 nomes cada); o resultado
lista as opcionais ignoradas. Notificações válidas não recebem resposta. Métodos futuros deverão validar params
(-32602), timeout (-32002), cancelamento (-32800) e contexto alterado (-32003).

Respostas têm o mesmo id e exatamente result ou error{code,message,data?}.
Notificações plugin.cancel{requestId} e plugin.progress{requestId,completed,total?}
reservam correlação; progresso de runtime não é implementado nem anunciado.
Runtimes futuros deverão tratar cancelamento e prazo de até 30 s, descartar
respostas tardias e associar cada chamada ao snapshot do contexto autorizado.
O adaptador de conformidade já testa cancelamento, prazo e mudança de contexto.

A saída rebar-batch/1 tem format, apiVersion:"1.0", units:{length:"mm",angle:"deg"}
e commands com operações da API AS-51. O adaptador desta etapa limita a geração
a bar.create no detalhe autorizado, representation.create e distribution.set
apenas sobre as barras criadas nesse lote. Operações de editar/apagar objetos
antigos não recebem autorização implícita. O host executa a validação real,
produz um recibo de prévia sem referência mutável ao projeto e exige confirmação.
A aplicação retorna uma única transação para o histórico existente (um Desfazer /
Refazer). Layers, visibilidade, isolamento, vínculos e limites continuam validados
pela API real. Cancelamento, erro, contexto alterado ou lote obsoleto não aplicam.

O outro formato de saída é um envelope explícito {format:"openstruct.detail/16",
package:...}. A implementação futura deve usar readDetailPackage e a comparação
AS-08; não adivinhar formato nem criar outro modelo de barras/pranchas.

## Proveniência e regeneração futura

Use o metadado AS-09 org.openstruct.plugin.provenance com JSON textual conforme
provenance.schema.json: pluginId, pluginVersion, packageSha256, generatorId,
parameters e units. pluginProvenance gera o mapa para createDetailPackage.
A importação existente preserva esse dado em detail.source.exchange.metadata;
reabrir e reexportar preserva o contrato sem migrar o schema do projeto.

A geometria resultante é nativa, editável e exportável sem o plugin instalado.
Regenerar poderá exigir versão/runtime compatíveis e parâmetros completos. Antes
de atualizar um detalhe, a integração futura deve usar a comparação seletiva AS-08
para preservar a decisão do usuário sobre edições locais. Não há motor de
regeneração nesta etapa. Código do plugin nunca deve ser serializado no projeto.

## Integridade, confiança e isolamento

trust:integrity-only significa hash/estrutura verificados, não autoria verificada.
O editor é declarado. Nenhuma chave incluída no pacote/catalogo vira confiável.
Este schema não aceita assinaturas improvisadas como comprovação de confiança.
Uma evolução de autenticação deverá definir envelope assinado canônico com
algoritmo, keyId, digest do artefato, assinatura, rotação/revogação e trust roots
externas ao pacote; somente chaves revisadas pelo host/catálogo poderão mudar o
estado de autoria. O catálogo de produtos e o instalador de atualizações do
ArmaduraStruct têm outro domínio de confiança e não são uma loja de plugins.

Permissões solicitadas não são concedidas por registro. Não há eval, import de
código baixado, shell, acesso ao projeto integral ou execução de instalação.
Protocolo não é isolamento: Worker, iframe e capabilities Tauri não equivalem a
sandbox universal. Um runtime futuro exige isolamento específico e concessões
mínimas por capacidade, além de autenticação independente. Metadados embutidos
são sempre texto; HTML/JS de descrições não é renderizado.
