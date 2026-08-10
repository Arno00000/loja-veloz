# ADR-003 — RabbitMQ para comunicação entre serviços

**Status:** Aceito · 2026-07-30

## Contexto

Os serviços precisam se comunicar. A escolha entre chamada síncrona e evento
assíncrono é a decisão mais consequente do projeto — ela determina o
comportamento sob pico, que é exatamente o cenário da campanha promocional.

Com chamada síncrona, o Serviço de Pedidos chamaria o Estoque e esperaria. Sob
pico, a espera vira acúmulo de conexões abertas; o Estoque lento transforma-se
em Pedidos lento, que transforma-se em Gateway lento. É a falha em cascata
clássica. O caso do Online Boutique (ver `docs/case-study.md`) usa exatamente
esse desenho, e é honesto reconhecer que funciona bem para demonstração.

## Decisão

**RabbitMQ** com exchange do tipo `topic`, comunicação exclusivamente por
evento entre domínios.

- exchange principal `loja-veloz.events`, durável
- `loja-veloz.retry` para reprocessamento com atraso
- `loja-veloz.dlx` para mensagens que esgotaram tentativas
- uma fila por consumidor, routing key idêntica ao `eventType`
- publisher confirms, acknowledgement manual, `prefetch` configurável
- retry limitado com atraso por TTL + dead-letter, **sem plugin externo**
- idempotência por `eventId` em tabela transacional

O único HTTP síncrono é Gateway → serviços, e ali a espera é aceitável porque o
cliente já está esperando.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| **HTTP síncrono entre serviços** | Acopla disponibilidade: Pagamento fora do ar impediria criar pedido. Sob pico, falha em cascata |
| **Apache Kafka** | Superior em throughput e em retenção de log de eventos. Descartado por complexidade operacional desproporcional: ZooKeeper/KRaft, partições, grupos de consumo e rebalanceamento são muito para 9 tipos de evento e 4 serviços. Kafka brilha em milhões de eventos por dia; aqui seria um cluster inteiro para operar sem necessidade |
| **Redis Streams / Pub-Sub** | Pub-Sub simples não garante entrega. Streams garante, mas exige mais código de consumidor e o Redis não é primariamente um broker |
| **Amazon SQS/SNS** | Gerenciado e robusto, mas amarra ao provedor e impede rodar tudo offline no ambiente local — requisito explícito do projeto |
| **Transactional outbox desde o início** | Seria mais correto. Descartado porque implementá-lo pela metade (sem processo de relay confiável) é pior que assumir a limitação. Ver Riscos |

## Consequências positivas

- **Desacoplamento temporal**: o Estoque pode estar fora do ar; a mensagem
  espera na fila e é processada quando ele voltar
- **Absorção de pico**: a fila age como amortecedor entre a taxa de chegada e a
  taxa de processamento
- Resposta imediata ao cliente: `201 Created` sem esperar o fluxo inteiro
- Novos consumidores podem ser adicionados sem alterar o produtor
- Interface de gerenciamento facilita a demonstração acadêmica

## Consequências negativas

- **Consistência eventual.** O cliente não sabe, na resposta, se o pedido foi
  confirmado
- **Mais um componente para operar**, monitorar e manter disponível
- Depuração exige tracing distribuído — sem ele, seria praticamente inviável
- **Entrega é "ao menos uma vez"**, nunca "exatamente uma vez". Todo consumidor
  precisa ser idempotente, e isso é código adicional em cada um
- Ordem entre eventos de filas diferentes não é garantida

## Riscos

| Risco | Mitigação | Residual |
|---|---|---|
| Mensagem perdida entre commit no banco e publish | Nenhuma completa. É a **janela do outbox** | **Sim, assumido.** Pedido fica PENDING sem evento; visível na consulta e nas métricas. Ver `docs/limitations-and-roadmap.md` |
| Duplicata processada duas vezes | `processed_events` com chave única, gravado na mesma transação do efeito | Baixo |
| Retry infinito consumindo o broker | `RABBITMQ_MAX_RETRIES` com teto de 20 validado por schema; testado em `retry-policy.test.ts` | Nenhum |
| Mensagem envenenada travando a fila | Payload que viola contrato vai direto para DLQ, sem retry | Baixo |
| Broker como ponto único de falha | Reconexão com backoff exponencial; readiness segura o tráfego | **Sim**: RabbitMQ local sem HA |
| DLQ crescendo sem ninguém olhar | Alerta `MensagensNaDLQ` dispara com qualquer mensagem em 10 min | Depende de o alerta ser roteado — não há Alertmanager configurado |

## Critérios de revisão

Migrar para Kafka se: volume passar de dezenas de milhares de eventos por
minuto, ou surgir necessidade de reprocessar histórico (event sourcing), ou de
múltiplos grupos de consumo independentes sobre o mesmo fluxo.

Implementar transactional outbox se: aparecer o primeiro pedido órfão em
produção. O padrão está descrito em `docs/limitations-and-roadmap.md`.
