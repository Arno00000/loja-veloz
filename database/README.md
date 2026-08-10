# Banco de dados

## Desenho adotado

Uma instância PostgreSQL, **três bancos logicamente separados**, um usuário por
serviço:

| Serviço               | Banco          | Usuário          | Tabelas                                                         |
| --------------------- | -------------- | ---------------- | --------------------------------------------------------------- |
| Serviço de Pedidos    | `orders_db`    | `orders_user`    | `orders`, `order_items`, `processed_events`                     |
| Serviço de Estoque    | `inventory_db` | `inventory_user` | `inventory_items`, `inventory_reservations`, `processed_events` |
| Serviço de Pagamentos | `payments_db`  | `payments_user`  | `payments`, `processed_events`                                  |
| API Gateway           | —              | —                | não possui banco                                                |

Cada serviço tem o seu próprio `schema.prisma`, as suas próprias migrations e
a sua própria `DATABASE_URL`. **Nenhum serviço consulta tabelas de outro.** A
única forma de um dado do domínio de pedidos chegar ao domínio de pagamentos é
através de um evento publicado no RabbitMQ.

## Por que uma instância só

É uma escolha de economia operacional do MVP acadêmico, não uma recomendação
de arquitetura. Uma instância significa: um contêiner, um volume, um
healthcheck, um ponto de restauração. Para um projeto de quatro semanas, isso
reduz drasticamente o atrito de setup.

O isolamento que importa — **de esquema e de credencial** — está preservado.
Como consequência, a evolução para instâncias separadas não exige mudar uma
linha de código de aplicação: basta trocar as três `DATABASE_URL`.

O que essa escolha **não** entrega, e que produção exigiria:

- isolamento de falha (a instância é ponto único de falha para os três domínios);
- isolamento de recursos (uma consulta pesada em `inventory_db` afeta os demais);
- escala independente por domínio;
- alta disponibilidade e réplicas de leitura;
- backup e restauração com granularidade por serviço.

**Evolução proposta:** uma instância Amazon RDS PostgreSQL por serviço, Multi-AZ,
com backups automáticos e credenciais no AWS Secrets Manager. Os módulos
Terraform em `terraform/modules/database` já são parametrizados para isso.

## Inicialização

O script `postgres-init/01-create-databases.sh` roda **apenas na primeira
subida** do contêiner, quando o volume de dados está vazio — é assim que o
entrypoint da imagem oficial funciona.

Para reexecutar do zero:

```bash
docker compose down -v
docker compose up -d postgres
```

`down -v` remove o volume e, com ele, todos os dados. Não use em ambiente que
você não possa perder.

## Migrations

As migrations **não são escritas à mão**. São geradas pelo Prisma:

```bash
# Criar a migration inicial (uma vez por serviço, com o banco no ar)
cd apps/order-service     && npx prisma migrate dev --name init
cd apps/inventory-service && npx prisma migrate dev --name init
cd apps/payment-service   && npx prisma migrate dev --name init
```

Isso cria `apps/<serviço>/prisma/migrations/<timestamp>_init/migration.sql`,
que **deve ser versionado no Git**.

Em staging e produção aplica-se apenas:

```bash
npx prisma migrate deploy
```

`migrate deploy` nunca gera migration nova e nunca apaga dados: ele só aplica
o que já está versionado. É o comando correto para pipeline.

No Docker Compose, isso é feito pelos serviços `*-migrate`, que rodam uma vez
e terminam. Os serviços de aplicação só sobem depois
(`condition: service_completed_successfully`).

## Seed

Só o Serviço de Estoque precisa de dados iniciais:

```bash
npm run seed -w @loja-veloz/inventory-service
```

Os dados são determinísticos (ver `apps/inventory-service/src/seed.ts`) e o
seed é idempotente — reexecutar devolve o ambiente ao estado conhecido. Os SKUs
`SKU-SEM-ESTOQUE` (saldo 0) e `SKU-ESTOQUE-BAIXO` (saldo 2) existem para os
cenários de falha reproduzíveis.

## Idempotência

Os três bancos têm uma tabela `processed_events` com `event_id` como chave
primária. O registro do evento acontece **na mesma transação** que aplica o
efeito de negócio. Isso é o que torna o consumo seguro diante da entrega "ao
menos uma vez" do RabbitMQ.

Consulta útil em diagnóstico:

```sql
-- Eventos processados nas últimas 24h, por tipo
SELECT event_type, COUNT(*)
  FROM processed_events
 WHERE processed_at > NOW() - INTERVAL '24 hours'
 GROUP BY event_type
 ORDER BY 2 DESC;
```

A tabela cresce indefinidamente. Em produção, uma rotina de expurgo
(por exemplo, remover registros com mais de 30 dias) é necessária; está
listada em `docs/limitations-and-roadmap.md`.
