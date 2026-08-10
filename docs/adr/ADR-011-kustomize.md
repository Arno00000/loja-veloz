# ADR-011 — Kustomize para os manifests da aplicação

**Status:** Aceito · 2026-07-30

## Contexto

Três ambientes (desenvolvimento, staging, produção) precisam dos mesmos
recursos com parâmetros diferentes: número de réplicas, tags de imagem, nível
de log, taxa de amostragem de traces, host do Ingress, e se os recursos
acadêmicos de demonstração ficam ligados.

Duplicar YAML por ambiente garante divergência: uma correção aplicada em
produção e esquecida em staging é questão de tempo.

## Decisão

**Kustomize** para os manifests **autorais** da aplicação, com uma base e três
overlays. **Helm** para os componentes de **terceiros** (Prometheus, Loki,
Jaeger, Alloy, Ingress Controller, Metrics Server), com valores versionados em
`kubernetes/helm-values/`.

A divisão é o ponto central desta decisão: **o que é nosso, Kustomize; o que é
de terceiro, Helm com valores versionados.**

## Alternativas consideradas

| Alternativa                                  | Por que não                                                                                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **YAML duplicado por ambiente**              | Diverge sozinho. Não é alternativa séria                                                                                                                                                                                 |
| **Helm para tudo, inclusive a aplicação**    | Templates com `{{ }}` transformam YAML em uma linguagem de template: o arquivo deixa de ser YAML válido e não pode ser validado sem renderizar. Para 13 manifests próprios, o ganho não compensa a perda de legibilidade |
| **Copiar os manifests dos charts oficiais**  | **Rejeitado explicitamente.** Copiar centenas de linhas geradas por um chart oficial para o repositório, fingindo instalação manual, torna a atualização impossível e é desonesto quanto à origem do código              |
| **jsonnet / ytt**                            | Mais poderosos, muito menos difundidos. Custo de aprendizado sem retorno proporcional                                                                                                                                    |
| **Só arquivos de patch com `kubectl patch`** | Imperativo, não versionável como estado desejado                                                                                                                                                                         |

## Consequências positivas

- Os manifests da base são **YAML válido** — leem-se e validam-se sem
  renderizar
- `kubectl kustomize <overlay>` roda **sem cluster**, e está no CI
- `kubectl` traz Kustomize embutido: nenhuma ferramenta extra
- `images:` permite ao pipeline fixar a tag por SHA com um comando
- `configMapGenerator` com hash força o rollout quando a configuração muda —
  sem isso, alterar ConfigMap não reinicia nada e o valor antigo continua em
  memória
- Diferença entre ambientes fica explícita e pequena, em vez de escondida em
  três arquivos completos

## Consequências negativas

- Menos expressivo que Helm: sem condicionais, laços ou funções
- Patch estratégico tem regras sutis. Um exemplo real deste projeto: um patch
  aplicado a todos os Deployments **não pode** tocar em `containers`, porque a
  fusão casa itens de lista pelo campo `name` — um nome genérico
  **acrescentaria** um contêiner em vez de alterar o existente. Por isso os
  ajustes por contêiner usam patch JSON6902, com alvo explícito
- Não há empacotamento nem versionamento como o Helm oferece
- Depurar overlay complexo exige renderizar e comparar

## Riscos

| Risco                                            | Mitigação                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Overlay quebrado só descoberto no apply          | `kubectl kustomize` dos três overlays roda no CI a cada PR                                                               |
| Patch silenciosamente sem efeito                 | Renderizar e conferir; a armadilha do `containers` está documentada no próprio arquivo de patch                          |
| Secret real versionado por engano                | Só `secret.example.yaml` com placeholders é versionado; o CI **verifica** que nenhum `secret.yaml` existe no repositório |
| Divergência entre overlay e realidade do cluster | `kubectl apply -k` é sempre a fonte da verdade; alteração manual no cluster é sobrescrita                                |

## Critérios de revisão

Migrar a aplicação para Helm se: for necessário distribuí-la como pacote
instalável por terceiros, ou se surgir lógica condicional real entre ambientes
(recurso que existe em um e não em outro, dependendo de valor).

Adotar Argo CD não exige trocar de ferramenta: ele suporta Kustomize
nativamente.
