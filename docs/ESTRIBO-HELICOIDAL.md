# Estribo helicoidal

> **Faixa Armaduras:** os dois comandos do helicoidal usam o menu compacto vigente, em uma coluna de ícones técnicos com nome acessível e ajuda por foco/hover. A rolagem e o isolamento de Enter/Espaço das setas são preservados. Os três aliases longos constam em Configurações → Atalhos, sem nova tecla curta.

Em **Armaduras → Estribo helicoidal** (comandos **HELICOIDAL** ou **ESTRIBOHELICOIDAL**, sem tecla curta), lance uma armadura contínua circular, como a de gaiolas de estacas, entre o início e o fim de um eixo. **Critérios do helicoidal** (comando **CRITERIOSHELICOIDAL**) configura os próximos lançamentos. O primeiro uso abre os critérios; os seguintes reutilizam os últimos valores confirmados. Para alterar uma peça existente, selecione-a e use **Editar critérios desta posição** nas propriedades.

Uma hélice é **uma única peça física contínua**: cada volta pertence à mesma barra. Ela não é uma série de estribos circulares planos, não usa faixa de distribuição e não herda do estribo plano ganchos de 135°, mandril, fechamento, espaçamento ou quantidade por faixa. A ferramenta detalha e quantifica. Ela não dimensiona, não verifica norma e não deduz cobrimento da fôrma, das barras longitudinais ou de critérios normativos.

## Convenções

- **φ** é a bitola do aço; **D** é o diâmetro do eixo da hélice, no eixo da barra. O desenvolvimento usa sempre D, nunca diretamente o diâmetro da estaca.
- Referências do diâmetro, com o D resultante mostrado na prévia:
  - diâmetro no eixo da barra: `D = valor informado`;
  - diâmetro externo da hélice (envelope do aço): `D = Dexterno − φ`;
  - seção de concreto + cobrimento radial `c` até a face externa da hélice: `D = Dconcreto − 2c − φ`.
- No modo eixo, alterar somente φ mantém o comprimento e muda a massa. Nos modos externo e concreto, φ altera D e o comprimento. Conversões que resultem em D ≤ 0 ou D ≤ φ são recusadas, sem correção silenciosa. O diâmetro da hélice não é mandril de dobra.
- **A** e **B** são os centros das seções inicial e final no eixo. `Hbruto = |B − A|` em verdadeira grandeza; com afastamentos `a` e `b`, `H = Hbruto − a − b` (precisa ser positivo). A e B definem a direção início→fim.
- **Passo p** é o avanço axial em uma volta completa, não a distância livre entre barras nem o espaçamento de peças.
- Referencial local: eixo `z` de A para B; `x̂` é a normal no plano do desenho, à esquerda de A→B; `ŷ` aponta para o observador. `(x̂, ŷ, ẑ)` é destro. Com `R = D/2`, fase `θ0` (graus na interface, radianos no cálculo) e sentido `s`:

```text
N = H / p
θ(t) = θ0 + s · 2πN · t,   0 ≤ t ≤ 1
x(t) = R cos θ(t),  y(t) = R sin θ(t),  z(t) = a + H · t
```

- **Sentido à direita** (`s = +1`, destro, como rosca comum): olhando de B para A, a barra gira no sentido anti-horário ao avançar. **À esquerda**: `s = −1`. θ0 = 0° coloca o ponto inicial do lado superior do eixo na vista longitudinal, e θ0 = 90°, voltado ao observador. A ponta final fica exatamente em `z = H`, com fase `θ0 + s·2πN`.
- Modo desta entrega: **passo fixo e extremos preservados**. N é real e pode ser fracionário (inclusive N < 1). N não é arredondado, o passo não é ajustado e não se acrescenta volta por existirem duas pontas. N não é `floor(H/p) + 1`.

## Comprimento, corte e massa

```text
Lcorpo = √((π·D·N)² + H²) = N · √((π·D)² + p²)
```

O cálculo usa precisão completa (`hypot`) e só arredonda na apresentação. Nunca usa circunferência × voltas, soma de cordas, projeção 2D ou percentual estimado. Nesta entrega, o corpo termina exatamente nos limites úteis: **sem ganchos, anéis terminais, voltas extras, transpasse ou perdas**. Essa é uma hipótese de cálculo mostrada na prévia, não uma recomendação construtiva. Portanto, `Lcorte = Lcorpo`. Não há controles de ganchos ou emendas que alterem apenas texto. Terminações modeladas, comprimento comercial, divisão em peças e otimização de corte ficam para evoluções explícitas.

```text
Qtotal = hélices × multiplicador da armadura × repetição do detalhamento
Ltotal = Lunitário / 1000 × Qtotal                         (m)
massa  = política central de 7.850 kg/m³ (src/domain/steel.ts)
```

N **nunca** multiplica a quantidade: o desenvolvimento unitário já contém todas as voltas. A vista longitudinal, a seção e os rebatimentos representam a mesma peça.

A memória (critérios, painel de lançamento e propriedades) mostra a referência, os valores informados, φ, D, Hbruto/a/b, H, p, N (completas + fração), Lcorpo, parcelas adicionais, Lcorte, massa linear e unitária e a quantidade física.

### Casos de referência (testes)

| Caso         | Entradas (mm)                         | Resultado                                               |
| ------------ | ------------------------------------- | ------------------------------------------------------- |
| Regular      | D 400; H 3.000; p 150; φ 8            | N = 20; L = 25.311,157256627 mm                         |
| Fracionária  | D 400; H 3.050; p 150                 | N = 20 + 1/3; L = 25.733,009877571 mm; fase final +120° |
| N < 1        | D 400; H 75; p 150                    | N = 0,5; L = 632,778931416 mm                           |
| Externo      | Dext 408; φ 8                         | D = 400; mesmo L do caso regular                        |
| Concreto     | Dconc 500; c 25; φ 10; H 3.000; p 150 | D = 440; L = 27.808,311074576 mm                        |
| Afastamentos | Hbruto 3.200; a = b = 100             | H = 3.000                                               |

Para φ8: 0,394584037291 kg/m e 9,987378618824 kg por hélice. Com 2 hélices × 3 × repetição 4, são 24 hélices, 607,467774159 m e 239,697086852 kg. A suíte também confere o comprimento analítico por amostragem fina da curva espacial (somente nos testes). Essas fixtures são matemáticas, não recomendações de detalhamento.

## Lançamento e edição

1. Ajuste **Peça** (aço, φ, referência e valor do diâmetro, passo), **Trecho** (comprimento declarado, afastamentos, sentido e fase), **Quantidade** e **Representação** e clique **Indicar o eixo da hélice**.
2. **Dois pontos A e B**: indique início e fim por clique, snaps ou coordenadas; `Hbruto` é medido entre os pontos. **Início, direção e comprimento**: indique A, informe a direção em graus e use o comprimento declarado nos critérios (Hbruto ou H, conforme a fonte escolhida).
3. Confira a prévia: projeção, eixo, limites úteis, D, φ, H, p, voltas completas + fração, comprimento desenvolvido, quantidade física e massa nominal.
4. Opcionalmente, use **Posicionar identificação**. É uma ação gráfica.
5. **Confirmar lançamento** ou Enter grava tudo em uma única operação. **Voltar etapa** corrige pontos e critérios; Esc ou **Cancelar lançamento** descartam sem resíduos. Enter repetido não duplica.

Antes da confirmação, não existe peça, posição, quantitativo ou histórico. Desfazer/Refazer tratam a peça, os critérios e os IDs como uma transação. Mudança de projeto, desenho, detalhamento, isolamento ou máscara durante a prévia cancela o comando. Destino, permissões, layers e bloqueios são revalidados na confirmação.

Editar os critérios de uma posição mantém o ID físico e os vínculos válidos, e atualiza todas as representações. Alterar p muda N e o comprimento; voltas não viram peças. Mover ou girar não muda o desenvolvimento. Copiar fisicamente cria novos IDs e material; criar ou copiar uma representação não cria aço. O **espelhamento físico** (Espelhar) reflete a peça e **inverte o sentido de enrolamento**, com fase `180° − θ0`. O espelhamento de uma representação é apenas gráfico e não altera a peça. Operações sem suporte para esta família (faixa de distribuição, divisão, emenda e edição de vértices) recusam com diagnóstico e não degradam a hélice para barra livre.

## Representação

- **Vista longitudinal**: projeção da hélice com eixo traço-ponto, limites úteis, marcas de início/fim e letras A/B. O trecho à frente (ŷ ≥ 0) é contínuo e o do fundo, tracejado. É representação, nunca geometria de corte.
- **Seção circular vinculada** (opcional): um único círculo com D e a referência rotulados; as voltas não são redesenhadas como anéis.
- **Cotas reais**: H (útil), a/b quando houver, D no eixo e **p entre duas cristas consecutivas** (uma volta completa, não meia onda). As mesmas primitivas alimentam canvas, prancha, PDF e DXF.
- **Aproximação gráfica adaptativa**: corda com flecha ≤ 0,5 mm do modelo (dividida pela escala da vista), de 8 a 256 pontos por volta, com no máximo 50.000 pontos por peça antes dos pontos exatos de troca frente/fundo. Os extremos, a fase final e a extensão são conservados. Zoom, escala, densidade, ocultação e estilos não afetam L, N ou massa.
- A identificação separa, por exemplo, `N1 - 1 hélice x Ø8 - 20 voltas - p=15,0 cm - C=25,311 m`. Não reutiliza legendas que pareçam 20 estribos planos.

## Fabricação, persistência e intercâmbio

A assinatura de fabricação identifica a família `helix`, D no eixo, H, p, φ, aço, sentido, terminações (`none`) e especificações de fabricação. Translação, giro rígido, fase, estilo, escala de vista e referência usada para chegar ao mesmo D não mudam a identidade. Hélices com o mesmo comprimento arredondado e parâmetros distintos não são agrupadas, e espelhos (sentido oposto) não são equivalentes. Ler a peça de B para A conserva o sentido e só troca as terminações.

- Formato nativo **`armadurastruct/33`** (lê 1–32) e pacote **`openstruct.detail/22`** (lê 1–21; [JSON Schema v22](openstruct-detail-v22.schema.json)). Arredondamento de cotas introduzido em /32 e /21 permanece preservado nos novos formatos; os schemas públicos anteriores ficam intactos. Os números /29 e /18 continuam reservados pelo PR #128. Arquivos anteriores abrem sem converter estribos em hélices nem alterar massas. Dados helicoidais sob versões antigas são recusados com diagnóstico, sem descarte silencioso.
- Persistem os parâmetros físicos, a referência original do diâmetro com os valores informados, a fonte declarada do trecho, os afastamentos, o sentido e a fase, a quantidade e a apresentação. Não se gravam caches de H, N ou L, que são sempre recalculados. Os campos planos herdados de `Bar` (`points`, `width`, `height`, `hook`, `mandrel`) são inertes nesta família.
- Pacotes em mm/cm/m convertem uma vez diâmetros, cobrimento, trecho, afastamentos, passo e bitola. Ângulos, sentido, voltas e quantidades não são escalados.
- A RA bloqueada mantém a fotografia e detecta mudanças físicas da hélice. Mudanças apenas de vista não alteram o material.
- **CSV**: mesmas colunas; quantidade de hélices, comprimento unitário/total e massa coerentes. **PDF** e **DXF**: o quadro de aço recebe uma linha de memória por posição helicoidal (D, H, p, N, C e quantidade). O DXF exporta a projeção 2D como polilinhas e não a anuncia como hélice espacial nativa. O arquivo nativo e o pacote preservam a família física.
- API de armaduras: família `helix` em `REBAR_CAPABILITIES` (referências de diâmetro, fontes do trecho, sentidos, limites, sem distribuição e sem passo variável), criação e edição com `helix`/`helixDisplay`. O runtime de plugins não foi alterado. Consumidores sem suporte recebem `FAMILY_MISMATCH` ou erro de validação.

## Validação e limites

Recusam-se valores não finitos; passo, diâmetro ou trecho não positivos; cobrimento ou afastamentos negativos; trecho útil nulo; quantidade fracionária ou nula; e D ≤ φ. Também se recusam **voltas sobrepostas**: a distância entre voltas adjacentes, `p · πD / √((πD)² + p²)`, menor que φ é incompatibilidade geométrica, não verificação normativa. Limites do software, verificados antes de alocar o traçado: 5.000 voltas por peça, trecho e passo até 1.000 m e diâmetros até 20 m. O erro informa qual limite foi atingido.

Fora desta entrega: plugin de estacas, dimensionamento ou regras normativas novas, hélice cônica ou de diâmetro variável, passo variável por trechos, ajuste por voltas inteiras, terminações modeladas e otimização de fabricação.

Testes: `tests/helix.test.ts` (fixtures, conversões, validações, sentido, fase, espelhos, fabricação, vistas, memória, persistência, RA, pacotes mm/cm/m, JSON Schema, API e saídas) e `tests/e2e/helix.spec.ts` (faixa em 1280/1366/1600 px, lançamento por dois pontos e numérico, cancelamento, Voltar, histórico, recuperação, edição pelo painel). Capturas: [critérios](helix-criteria.png), [prévia](helix-preview.png) e [quadro de aço](helix-schedule.png). As capturas incluídas são do autor, anteriores à integração. A interação da integração é verificada pelo CI remoto em Chromium. A interação nativa do aplicativo desktop (Windows/Linux) não foi exercitada.
