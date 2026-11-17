# Manipular armaduras

No desenho, selecione uma ou mais armaduras físicas editáveis do detalhamento ativo. Abra **Armaduras → Manipular** e escolha a operação.

- **Copiar armadura**. Clique no ponto base e no destino. A prévia mostra o deslocamento da seleção. Ao confirmar, as cópias recebem novos IDs e o quadro de aço considera as novas peças.
- **Mover armadura**. Clique no ponto base e no destino. O conjunto mantém o espaçamento entre as peças e conserva os IDs originais.
- **Rotacionar armadura**. Clique no pivô, em um ponto para indicar a direção inicial e em outro para indicar a direção final. Para usar um valor em graus, escolha **Ângulo digitado** em **Definição do ângulo**. Confira a prévia e selecione **Aplicar transformação**. O giro conserva as dimensões e os quantitativos das peças.

Use os encaixes do desenho ao indicar pontos. **Esc** cancela a operação em andamento. Cada operação confirmada ocupa uma entrada no histórico de **Desfazer/Refazer**.

Para **copiar ou mover por distância**, indique o ponto base, aponte o cursor na direção desejada e digite a distância em milímetros. Pressione **Enter** para confirmar. A direção segue a prévia, inclusive com ORTO ou encaixes ativos. A distância digitada prevalece sobre um encaixe próximo ao destino. Para informar os dois componentes do deslocamento diretamente, use coordenadas relativas, como `@300,400`.

## Copiar e colar pelo teclado

1. Com foco no desenho e uma seleção válida, pressione **Ctrl+C** para guardar a seleção para cópia.
2. Pressione **Ctrl+V** e mova o cursor para posicionar a prévia. O primeiro vértice da primeira armadura selecionada serve de ponto base.
3. Clique no destino ou confirme um deslocamento digitado. Pressione **Ctrl+V** novamente para colocar outra cópia. **Esc** cancela a colocação atual.

A cópia pelo teclado está disponível no mesmo projeto e detalhamento. Nos campos de edição e na linha de comando, os atalhos continuam usando a área de transferência do sistema.

## Vínculos da cópia

As cópias reaproveitam a clonagem de armaduras, que remapeia as referências internas do conjunto. Quando há dependências compartilhadas, o painel abre uma prévia e pede que você escolha como tratar os vínculos. A clonagem do conjunto conectado precisa respeitar as proteções do detalhamento ativo. Veja [Duplicar a armadura completa](AS-53.md) para entender os vínculos e as posições de fabricação.
