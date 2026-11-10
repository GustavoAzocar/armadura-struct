# Rotacionar máscaras

Em **Máscaras → Manipular → Rotacionar**, confira a máscara ativa. Clique nas entidades no CAD ou use a lista. Clique novamente para retirar uma entidade. A pré-seleção no Controle de máscaras também pode ser usada. Para girar a referência inteira, escolha **Máscara inteira** em **Alvo da rotação**. Pressione Enter para concluir a seleção.

1. Indique o ponto base por clique, snap ou coordenadas no **Comando CAD**. A base pode estar fora da seleção.
2. Digite o ângulo em graus ou indique a direção com o cursor a partir da base. A direção +X vale 0°. O sentido positivo é anti-horário. Os encaixes e o ortogonal seguem as configurações do CAD.
3. Para alinhar uma direção existente, escolha **Referência**. Informe o ângulo atual ou capture dois pontos orientados, em qualquer posição. Em seguida, indique a nova direção a partir da base ou digite seu ângulo absoluto. O comando aplica a diferença entre as direções à seleção.
4. Confira o ângulo e a prévia. Pressione Enter ou clique **Confirmar rotação** para aplicar uma única operação. **Alterar ângulo** volta à escolha da direção. Esc cancela a sessão. Desfazer e Refazer atuam sobre o lote inteiro.

O campo de ângulo aceita vírgula ou ponto decimal. Na linha de comando, use `-12.5` ou `-12,5°`. Sem o símbolo de grau, a vírgula continua separando as coordenadas X,Y. Coordenadas absolutas, `@dx,dy` e `@distância<ângulo` são em mm do modelo. `ROTACIONARMASCARA` e `ROTATE` abrem o comando pelo teclado. Na aba Máscaras, `ROTACIONAR` e `GIRAR` também abrem o comando.

## Escopo e precisão

- **Entidades** gira somente o conjunto escolhido. Preserva IDs, layers, estilos, linhagem e a transformação da máscara. **Máscara inteira** gira a origem em torno da base e compõe a orientação, mantendo as primitivas locais e a escala. Se um layer impedir edição, a máscara inteira fica indisponível para rotação.
- Círculos mantêm o raio, arcos mantêm o raio e a abertura, e polilinhas conservam o fechamento. Retângulos que se tornam oblíquos são armazenados como contornos fechados de quatro vértices exatos. Textos giram com sua âncora e direção da linha base. Referências importadas usam a geometria que o leitor conseguiu trazer para o projeto.
- A rotação é local ao projeto. Barras, posições, cotas estáticas e quantitativos são independentes. A prévia é descartada se o projeto, desenho, isolamento ou máscara ativa mudar. Ângulos de 0° ou voltas completas encerram a sessão sem gravar no histórico.
- O formato de projeto e o pacote de detalhamento já suportam toda a geometria produzida. A saída PDF/DXF usa a representação existente de círculos e arcos em segmentos, com erro radial nativo de até 0,05 × escala da máscara em mm do modelo. O DXF grava esses contornos em LWPOLYLINE. Os dados analíticos permanecem no projeto e no intercâmbio OpenStruct.

Os testes de domínio estão em `tests/maskRotate.test.ts`. A suíte `tests/e2e/maskRotate.spec.ts` exercita o fluxo no navegador e grava as capturas de seleção, base, prévia, referência e modo Foco em `test-results/`.
