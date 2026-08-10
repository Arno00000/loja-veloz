# ADR-001 — Monorepo com npm workspaces

**Status:** Aceito · 2026-07-30

## Contexto

Quatro aplicações compartilham contratos de evento, carregamento de
configuração, cliente de mensageria e instrumentação de observabilidade. Sem
compartilhamento, esse código seria duplicado quatro vezes — e divergiria na
primeira correção aplicada em apenas um lugar.

O risco específico e concreto: se o Serviço de Pedidos alterar o payload de
`order.created` e o Serviço de Estoque não for atualizado, o erro só aparece em
produção, quando a mensagem chega e falha na desserialização.

## Decisão

Monorepo único com **npm workspaces**, sem Yarn, pnpm, Nx, Turborepo ou Lerna.

- `packages/` — código compartilhado (`shared-types`, `shared-config`,
  `observability`, `messaging`)
- `apps/` — as quatro aplicações
- `tsconfig.base.json` na raiz, estendido por cada workspace
- scripts centralizados no `package.json` da raiz
- **um único `package-lock.json`**, gerado por `npm install` e versionado

Os contratos de evento vivem em `packages/shared-types` e são importados pelos
produtores e pelos consumidores. Um payload fora do contrato quebra o
`npm run build`, não a produção.

## Alternativas consideradas

| Alternativa                               | Por que não                                                                                                                                                                                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Polirepo** (um repositório por serviço) | Alterar um contrato exigiria PR coordenado em 3 repositórios, publicação de pacote versionado e atualização de dependência em cada um. Para uma equipe pequena com prazo de 4 semanas, o custo de coordenação supera o benefício de isolamento |
| **Nx ou Turborepo**                       | Trazem cache distribuído e grafo de tarefas — valiosos em repositórios grandes. Com 8 workspaces, o ganho é marginal e o custo é mais uma ferramenta para instalar, configurar e ensinar                                                       |
| **pnpm workspaces**                       | Tecnicamente superior em uso de disco e rigor de resolução. Descartado por decisão explícita de padronizar npm: misturar gerenciadores é fonte clássica de lockfile inconsistente                                                              |
| **Código duplicado**                      | Diverge sozinho. Não é alternativa séria                                                                                                                                                                                                       |

## Consequências positivas

- Contrato de evento validado em tempo de compilação, nas duas pontas
- Uma alteração atômica em um único commit e um único PR
- Um `npm ci` instala tudo; um `npm run build` compila tudo
- Ferramental (ESLint, Prettier, Jest, TypeScript) configurado uma vez
- `npm` já vem com o Node: zero instalação extra no ambiente de CI

## Consequências negativas

- Build do monorepo inteiro é mais lento que o de um serviço isolado
- Uma alteração em `packages/` afeta os quatro serviços de uma vez — o alcance
  do erro é maior
- Todos os serviços ficam presos à mesma versão de TypeScript e Node
- O contexto de build das imagens Docker precisa ser a raiz, o que torna o
  Dockerfile menos óbvio e exige `.dockerignore` bem feito
- npm workspaces não garante ordem topológica em `--workspaces`: por isso o
  script de build lista os pacotes explicitamente, na ordem correta

## Riscos

| Risco                                                         | Mitigação                                                                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Acoplamento acidental entre serviços por um import indevido   | Regra de revisão: nenhum `apps/X` importa de `apps/Y`. Não há verificação automatizada — é uma lacuna conhecida |
| Build lento conforme o repositório cresce                     | Cache do npm no CI por lockfile; cache de camadas do Docker por escopo de serviço                               |
| `package-lock.json` como ponto de conflito frequente em merge | Resolver sempre regenerando com `npm install`, nunca editando à mão                                             |

## Critérios de revisão

Reavaliar se:

- o número de serviços passar de ~10, ou
- equipes distintas passarem a ter ciclos de release independentes, ou
- o tempo de CI ultrapassar 15 minutos de forma consistente

Nesse ponto, a migração natural é adicionar Nx **sobre** o npm workspaces
(cache e grafo de tarefas, sem trocar o gerenciador), antes de considerar a
quebra em polirepo.
