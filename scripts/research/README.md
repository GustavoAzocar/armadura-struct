# Pesquisa de renderização — issue #148

Os scripts são instrumentação descartável de pesquisa, fora do bundle. Leia primeiro [o relatório](../../docs/ANALISE-RENDERIZADOR-CAD.md). Os resultados versionados foram obtidos no commit AS d402139 e na release web CADCraft 0.20.1; não representam GPU física ou desktop nativo.

## Preparar

Instale as dependências usuais do repositório (`npm ci`) e use Chromium/Playwright. O binário usado aqui foi `/usr/bin/chromium`; adapte a variável ao seu ambiente. Faça build de produção com os mesmos parâmetros:

```sh
npm run build -- --sourcemap
```

Baixe **do repositório oficial** `storytold/cadcraft`, release `v0.20.1`, o arquivo `cadcraft-web-0.20.1.zip` e `SHA256SUMS.txt`. Compare o SHA-256 do ZIP com o publicado e com o manifesto da investigação:

```text
300e870c50b66d371055915ba95e3ddbfd4c45431466d5214743b5dcab95a0e1
```

URLs e método de verificação: [artifact.json](../../docs/performance/render148/artifact.json). Extraia o ZIP. Em outro terminal, sirva a pasta que contém `index.html`:

```sh
python -m http.server 1421 --bind 127.0.0.1 --directory /caminho/cadcraft-web-0.20.1
```

Mantenha a porta 1420 livre: cada helper AS inicia/encerra seu preview Vite. Não execute medições em paralelo com builds, testes, outros benchmarks ou sessões gráficas pesadas. O ambiente registrado usa SwiftShader e as séries CADCraft podem levar muitos minutos. Os arquivos são salvos por cena; se uma execução parar, não chamar arquivo parcial de suíte completa.

## Executar séries sequenciais

```sh
export ARMSTRUCT_CHROMIUM=/usr/bin/chromium
export ARMSTRUCT_CHROMIUM_ARGS='["--no-sandbox"]'

node scripts/cad-benchmark.mjs --label=issue148-d402139 --samples=60 --repeats=3 --actions=cursor-no-snap,pan,zoom --output=docs/performance/render148/armadura-representative.json
node scripts/research/render148-study.mjs --apps=armadura --label=armadura
node scripts/research/render148-study.mjs --apps=cadcraft --label=cadcraft
node scripts/research/render148-diagnostics.mjs
node scripts/research/render148-study.mjs --scenes=quality --dpr=2 --label=quality-dpr2
node scripts/research/render148-summarize.mjs
```

`render148-scenes.mjs` é a única fonte dos DXFs sintéticos, independentes das duas aplicações. `render148-study.mjs` usa os leitores e o build real do AS e a ponte pública CADCraft (`data-host="page"`, evento `cadcraft:open`). Normaliza a opacidade da máscara comum para 1. Não normaliza o layout inteiro das UIs ou as políticas de pena; os retângulos de canvas e contadores reais ficam no JSON. Não modifica o WASM nem o renderer de produção.

`render148-diagnostics.mjs` aplica uma translação **só no DOM derivado** para verificar o caso 1e8 e captura tracing de 30 movimentos de pan. Esse ensaio com tracing fica separado dos quantis sem tracing. `getTotalLength()` é API de apresentação, não comprimento de fabricação. As categorias do trace se sobrepõem e não podem ser somadas como tempo de parede.

Os JSONs comuns incluem arrays de frames/eventos/long tasks. O benchmark existente guarda estatísticas por repetição e resumo amostrado de perfil. Abertura até ready, dois frames, heap V8/backing storage e os contadores internos CADCraft têm semânticas diferentes: consulte o relatório antes de comparar números. `renderer: gpu` não significa GPU física. CPU do processo gráfico por software no snapshot não é tempo GPU nem VRAM.

O `--scene=large --actions=grip --samples=30 --repeats=1` do benchmark existente foi usado separadamente como exploração de edição, sem misturá-lo às três repetições de navegação. A tentativa piloto `switch-drawing` falhou em seletor na cena vazia; não há resultado publicado dessa ação.

Imagens são capturas próprias das fixtures; DXFs são gerados, comprimidos com gzip para reduzir o volume. O código/artefato CADCraft não foi incorporado em produção. Metadados de licença de dependências são amostra, não uma auditoria completa do grafo ou dos assets.
