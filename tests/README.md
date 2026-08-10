# Testes

## Camadas

| Camada | Onde | Roda contra | Quando |
|---|---|---|---|
| Unitário | `packages/*/src/__tests__`, `apps/*/src/__tests__` | dublês em memória | todo push e PR |
| Integração | `tests/integration` | stack real do Compose | todo push e PR |
| Smoke | `tests/smoke` | ambiente já implantado | após cada deploy |

A divisão segue um critério: **o que o teste precisa provar**.

Máquina de estados, validação Zod, cálculo de total, política de retry e o
simulador de pagamento são lógica pura — teste unitário com dublê, rápido e
determinístico. Já "o evento sai do Serviço de Pedidos, é roteado pelo
RabbitMQ e o Estoque reserva no PostgreSQL" **não pode ser validado com mock**:
um mock provaria apenas que o mock funciona. Por isso os testes de integração
sobem a stack de verdade.

## Determinismo

Nenhum teste depende de aleatoriedade, de internet ou de serviço pago.

Os cenários de falha são forçados por dados semeados, não por sorteio:

| Cenário | Como é forçado |
|---|---|
| Falha de estoque | `SKU-SEM-ESTOQUE`, saldo 0 no seed |
| Saldo insuficiente | `SKU-ESTOQUE-BAIXO`, saldo 2 no seed |
| Falha de pagamento | `CUSTOMER-PAYMENT-FAIL`, recusa configurada |

Aleatoriedade tornaria a suíte instável: um teste que falha uma vez a cada
vinte execuções acaba sendo ignorado, e um teste ignorado não protege nada.

## Executar

```bash
# Unitários (compila os pacotes compartilhados antes)
npm run test
npm run test:coverage

# De um workspace só
npm run test -w @loja-veloz/order-service

# Integração
docker compose -f docker-compose.test.yml up --build -d --wait
npm run test:integration
docker compose -f docker-compose.test.yml down -v
```

`--wait` faz o Compose aguardar os healthchecks. Sem ele, os testes começariam
antes de a stack estar pronta.

```bash
# Smoke, contra a stack local
bash tests/smoke/smoke.sh

# Smoke, contra outro endereço
GATEWAY_URL=https://staging.loja-veloz.example.com bash tests/smoke/smoke.sh

# Windows sem WSL
pwsh tests/smoke/smoke.ps1
```

## Cenários cobertos

1. **Criação de pedido com sucesso** — unitário + integração
2. **Consulta do pedido** — unitário + integração
3. **Falha de estoque** — unitário + integração
4. **Falha de pagamento** — unitário + integração
5. **Liberação de estoque após falha de pagamento** — unitário + integração
6. **Evento duplicado** — unitário nos três serviços (mesmo `eventId` duas vezes)
7. **Payload inválido** — unitário + integração (7 variações)
8. **Pedido inexistente** — unitário + integração
9. **Healthcheck** — unitário (liveness responde mesmo com dependência caída) + smoke
10. **Indisponibilidade temporária de dependência** — unitário (readiness devolve 503; Gateway traduz timeout em 504 e conexão recusada em 503)

Além desses, a integração cobre concorrência: cinco pedidos simultâneos do
mesmo SKU com saldo 2, verificando que no máximo dois são confirmados e que o
saldo nunca fica negativo.

## Por que a integração roda sequencial

`maxWorkers: 1` em `tests/integration/jest.config.js`. Os testes compartilham
o mesmo catálogo de estoque semeado; em paralelo, um teste consumiria o saldo
que outro espera encontrar, e as asserções sobre quantidade ficariam
imprevisíveis. Isolar por SKU exclusivo em cada teste seria a alternativa, ao
custo de um seed bem maior.

## Por que existe `waitFor` em vez de `sleep`

O fluxo é assíncrono: o `POST` devolve 201 imediatamente e o estado final só
chega depois de a cadeia de eventos atravessar três serviços. Um `sleep` fixo
seria lento no melhor caso e instável no pior — a máquina de CI é mais lenta
que a do desenvolvedor. O `waitFor` faz polling e termina assim que a condição
se cumpre, com prazo máximo e mensagem de erro que inclui o último valor
observado.

## Limitações

- Sem teste de carga. O comportamento sob pico real não foi medido; **nenhuma
  afirmação de desempenho neste projeto é sustentada por dados**. A ferramenta
  indicada é o k6 (ver `docs/limitations-and-roadmap.md`).
- Sem chaos engineering: derrubar o RabbitMQ no meio do fluxo e observar a
  reconexão é feito manualmente, conforme o runbook, e não automatizado.
- Sem teste de contrato entre produtor e consumidor (Pact). Hoje a garantia
  vem dos schemas Zod compartilhados, que são validados nas duas pontas.
- Cobertura não tem limiar mínimo configurado. O relatório é publicado como
  artefato do CI, mas não quebra o build.
