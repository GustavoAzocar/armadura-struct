# Grampo de viga em U

Em **Armaduras → Grampo de viga** (comando **GV**), informe as medidas reais da peça e posicione o esquema sem desenhar polilinhas. **Critérios do grampo de viga** (comando **CRITERIOSGRAMPO**) configura os próximos lançamentos. O primeiro uso abre os critérios; os seguintes reutilizam os últimos valores. Para alterar uma peça existente, selecione-a e use a edição de critérios nas propriedades.

Esta família tem duas pernas longitudinais e um lado transversal fechado. Bitola, mandril, aço e terminações são definidos pelo projetista. A ferramenta detalha e quantifica; não dimensiona ancoragem nem certifica a solução estrutural. Grampos S/C de pilar e estribos de múltiplos ramos são outras famílias.

## Convenção das medidas

**L** é o comprimento de cada perna longitudinal até a linha transversal teórica. **T** é a distância entre os eixos das duas pernas. As medidas chegam aos vértices teóricos, antes do arredondamento das dobras; não representam dimensão externa, vão livre, seção de concreto ou cobrimento. Os desenhos da janela de critérios mostram simultaneamente o desenvolvimento físico e a perspectiva.

Sem ganchos adicionais, o raio pelo eixo é `R = (mandril interno + bitola) / 2`. As retas medem `L − R`, `T − 2R` e `L − R`; as duas dobras de 90° somam `πR`. Portanto:

```text
Cgeom = 2L + T − 4R + πR
```

Para L = 600 mm, T = 300 mm, Ø10 mm e mandril interno de 50 mm, R = 30 mm e o comprimento geométrico é **1.474,2477796 mm**. O motor conserva as dobras analíticas no cálculo. Dimensões sem espaço para as dobras, números inválidos e terminações impossíveis impedem a confirmação com uma explicação; não há ajuste silencioso.

As duas pontas abertas têm ganchos independentes, em mm ou × bitola. O U básico começa sem ganchos adicionais. A geometria real dos ganchos entra no comprimento, mesmo quando sua exibição é desativada. Especificações textuais de fabricação não criam comprimento extra. Esta entrega não oferece ajuste comercial de corte: seu valor é zero e o comprimento de corte coincide com o geométrico, sem acréscimos ocultos.

## Lançamento e edição

1. Ajuste **Peça**, **Quantidade** e **Representação** e clique **Posicionar grampo**.
2. Clique ou informe um ponto no comando CAD. A inserção é o meio do trecho transversal do eixo, no lado fechado do U, marcado na prévia. O ponto posiciona o desenho e não cria vínculo automático com um apoio.
3. Confira a orientação informada. **Definir direção por segundo ponto** captura uma direção opcional sem alterar L ou T. **Alternar dobra esquerda/direita** muda o lado fechado do esquema durante a prévia.
4. Se necessário, reabra os critérios ou reposicione a identificação. A posição do texto não muda geometria, corte ou quantidade.
5. Use **Confirmar lançamento** ou Enter. Com ângulo definido e quantidade manual, um único ponto basta. **Voltar etapa** permite corrigir a captura; Esc ou **Cancelar lançamento** descarta a operação inteira.

O lançamento só altera o projeto na confirmação, em uma operação. Desfazer remove a peça e suas informações vinculadas; Refazer restaura os mesmos IDs. Enter repetido não cria outro grampo. Uma troca de projeto ou contexto durante a prévia cancela o comando. As permissões do desenho, detalhamento ativo, isolamento, layers e bloqueios da relação do aço são revalidados na confirmação.

Critérios gerais não alteram peças já existentes. Editar os critérios de uma posição mantém sua identidade e atualiza todas as vistas vinculadas. Copiar uma peça física acrescenta material; criar ou copiar uma representação gráfica mantém o mesmo ID físico e não acrescenta unidades.

## Quantidade e distribuição opcional

O padrão é **quantidade manual**. Conta-se um grampo completo: as duas pernas são partes de uma peça. Quantidade base, multiplicador da armadura e repetição do detalhamento permanecem separados. Por exemplo, **9 × 2 × 3 = 54 grampos**; no caso analítico acima, o comprimento total é **79,6093801 m**. A massa usa o comprimento de corte e a bitola, pelo contrato existente de densidade de 7.850 kg/m³.

A distribuição exige ativação explícita e captura separada de início e fim. Sua direção pode diferir do eixo longitudinal do grampo. **L não é comprimento da faixa; T não é espaçamento entre grampos.** Não há distribuição automática pelo vão nem vínculo estrutural com linhas ou apoios.

Informe afastamentos e quantidade fixa ou espaçamento máximo/fixo. Com faixa de 1.100 mm, afastamentos de 50/75 mm e passo máximo de 200 mm, resultam **6 estações com passo de 195 mm**. Com passo fixo de 200 mm, resultam **5 estações**, conforme a política existente. Mover a identificação não altera as estações. A faixa e as vistas representam a mesma quantidade física.

## Peça física e vistas vinculadas

A perspectiva comprime e inclina a direção transversal para legibilidade. **Suas cotas são reais; o esquema não serve para medir T em escala.** Projeção, lado fechado, escala, rotação gráfica, visibilidade de ganchos e posição da identificação pertencem à apresentação e não mudam corte, massa ou identidade de fabricação. L e T são parâmetros físicos: sua edição atualiza as vistas do mesmo grampo.

O desenvolvimento plano cotado referencia a mesma peça. Rebatimentos e vistas adicionais não somam aço. A assinatura de fabricação distingue a família, L, T, material, bitola, mandril e terminações; igualdade apenas do comprimento total não basta para fundir peças.

Canvas, prancha, PDF e DXF usam a apresentação compartilhada e as cotas reais. Arcos sob projeção oblíqua são aproximados por polilinhas, com erro máximo de corda de **0,05 mm do modelo**, incluindo a escala da representação. Não são exportados como arcos circulares falsos. No desenvolvimento plano, o DXF conserva os arcos circulares analíticos. A aproximação gráfica nunca fundamenta corte ou massa.

## Persistência e validação

O formato nativo é **armadurastruct/30** e o pacote de detalhamento **openstruct.detail/19**. Os números /29 e /18 foram reservados pelo PR paralelo #128; esta entrega não depende da integração dele. Salvar/reabrir, recuperação e API preservam parâmetros físicos, aparência e vínculos. Projetos anteriores continuam com suas famílias e resultados: barras livres e estribos não são convertidos implicitamente. Cópias e transferência remapeiam os IDs necessários.

Pacotes mm/cm/m convertem comprimentos físicos e coordenadas uma vez; ângulos, escalas, contagens, multiplicadores e fatores × bitola permanecem adimensionais. Relação do aço, escopos de prancha/elemento e CSV contabilizam a peça física, mesmo quando somente uma vista gráfica está visível.

Os testes de domínio cobrem o caso analítico, terminações, incompatibilidades, identidade de fabricação, quantitativos, persistência e intercâmbio. O fluxo Playwright cobre lançamento e edição no navegador, cancelamento, histórico, recuperação e representações vinculadas. Capturas: [critérios](beam-clamp-criteria.png), [prévia inclinada](beam-clamp-preview.png) e [vistas vinculadas](beam-clamp-views.png). Os resultados reais dos comandos de validação acompanham a contribuição. A interação nativa do aplicativo desktop deve ser distinguida da verificação em Chromium; compilar instaladores não constitui teste interativo nativo.
