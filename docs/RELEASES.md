# Distribuição desktop

O código do ArmaduraStruct fica neste repositório. Os instaladores assinados ficam no hub público `ricardocorsini/openstruct-catalog`, com tags `armadurastruct-vVERSÃO`. Windows (NSIS por usuário) e Linux (AppImage), ambos x86_64, são publicados juntos.

## Publicar uma versão

1. Execute `npm run release:version -- 0.3.0` com a nova versão, rode os testes e faça o commit. Aguarde o CI completo desse SHA, incluindo os builds desktop, antes de publicar.
2. Execute **Prepare release tag** em Actions, informando `v0.3.0`. Alternativamente, altere `.github/release-request.json` com `schemaVersion: 1`, `tag` e `commit` (SHA completo). Tags existentes nunca são substituídas.
3. No repositório `launcher-struct`, execute **Publish ArmaduraStruct** com a tag e o mesmo SHA completo. Também é possível registrar essa solicitação em `.github/armadura-release-request.json` na branch padrão do Launcher.
4. O publicador valida repositório, tag, commit e as versões dos manifests; compila os dois sistemas; verifica e assina os pacotes; publica a release completa no hub. O catálogo assinado é sincronizado em seguida (ou na próxima execução periódica).

As chaves permanecem nos Secrets do publicador. O código público do ArmaduraStruct é compilado em jobs sem as chaves de assinatura ou o token de publicação. O job de assinatura executa apenas o tooling fixado por SHA do hub, em um checkout separado. A assinatura vincula aplicativo, versão, plataforma, tamanho, hash e executável; pacotes de outro produto não podem ser reaproveitados.

O ArmaduraStruct utiliza a identidade de assinatura do publicador central (`launcher-packages-v1`), já confiada pelos Launchers 0.2.x. A chave de catálogo não é reutilizada. O catálogo mantém o identificador de ícone compatível com a versão 1 do esquema; o Launcher 0.2.4 associa o ID do aplicativo à gravura de Hefesto. Launchers anteriores continuam validando o catálogo e apresentam o símbolo genérico até serem atualizados.

## Identidade nativa

O PNG original é mantido no acervo de identidade visual do projeto. Para regenerar os formatos de desktop: `npx tauri icon /caminho/ArmaduraStruct_Icone_Original_1254x1254.png --fit contain`. Mantenha no repositório apenas os PNG/ICO utilizados no Windows e Linux. O WebP em `public/brand` é usado no cabeçalho do editor.
