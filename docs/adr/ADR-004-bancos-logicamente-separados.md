# ADR-004 — Bancos logicamente separados em instância única

**Status:** Aceito · 2026-07-30

## Contexto

O padrão _Database per Service_ diz que cada serviço deve ser dono exclusivo
dos seus dados. Aplicá-lo ao pé da letra significaria três instâncias
PostgreSQL — três contêineres, três volumes, três healthchecks, três pontos de
restauração — em um projeto de quatro semanas com foco em demonstrar o pipeline
completo.

A pergunta real: **qual parte do isolamento entrega o valor?**

## Decisão

Uma instância PostgreSQL, **três bancos separados, três usuários separados**:

| Serviço    | Banco          | Usuário          |
| ---------- | -------------- | ---------------- |
| Pedidos    | `orders_db`    | `orders_user`    |
| Estoque    | `inventory_db` | `inventory_user` |
| Pagamentos | `payments_db`  | `payments_user`  |

Cada serviço tem o seu `schema.prisma`, as suas migrations e a sua
`DATABASE_URL`. Cada usuário tem permissão **apenas** no seu banco. O Gateway
não tem banco.

Nenhum serviço consulta tabela de outro — e não conseguiria, porque a
credencial não permite.

## Alternativas consideradas

| Alternativa                                | Por que não                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Instância por serviço**                  | Correto para produção. Descartado no MVP por custo operacional. A migração não exige mudar código: só as três `DATABASE_URL`                |
| **Um banco, três schemas**                 | Isolamento mais fraco: um `GRANT` distraído torna tudo acessível. A separação por banco é uma fronteira mais difícil de violar por acidente |
| **Um banco, tudo junto**                   | Elimina a fronteira. Em pouco tempo aparece o primeiro `JOIN` entre pedido e pagamento, e a arquitetura vira monólito distribuído           |
| **Um único `schema.prisma` compartilhado** | Expressamente rejeitado: daria a todos os serviços os tipos de todas as tabelas, convidando ao acoplamento                                  |

## Consequências positivas

- Fronteira de dados real, imposta por credencial e não por disciplina
- Migrations independentes: alterar o schema de pedidos não toca em pagamentos
- Um contêiner, um volume, um healthcheck no ambiente local
- Evolução sem refatoração de código

## Consequências negativas

**O que esta escolha explicitamente NÃO entrega:**

- **Isolamento de falha.** A instância é ponto único de falha para os três
  domínios. Se ela cair, tudo cai
- **Isolamento de recursos.** Uma consulta pesada em `inventory_db` compete por
  CPU e I/O com os outros dois
- **Escala independente** por domínio
- **Backup e restauração com granularidade por serviço**
- O `max_connections` é compartilhado — e é ele, não a CPU, que limita o número
  de réplicas dos serviços (ver ADR-012)

## Riscos

| Risco                                                | Mitigação                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| Alguém adicionar permissão cruzada "temporariamente" | Script de init versionado e revisável; `REVOKE ALL ... FROM PUBLIC` explícito |
| Esgotamento de conexões com o HPA escalando          | `connection_limit=10` na URL e `maxReplicas` calibrado por esse teto          |
| Falsa sensação de que o isolamento é completo        | Este ADR e `database/README.md` declaram exatamente o que falta               |

## Critérios de revisão

Migrar para instância por serviço quando: houver requisito de disponibilidade
por domínio, ou uma carga de leitura pesada afetar os demais, ou o volume de um
domínio exigir dimensionamento próprio.

Os módulos Terraform em `terraform/modules/database` já são parametrizados para
múltiplas instâncias.
