# ADR-007 — OpenTelemetry para tracing distribuído

**Status:** Aceito · 2026-07-30

## Contexto

Um pedido atravessa quatro processos e cinco eventos até chegar ao estado
final. Quando algo demora ou falha, a pergunta "onde?" não tem resposta óbvia:
pode ser o Gateway, o banco de pedidos, a fila, a transação de reserva ou o
simulador de pagamento.

Log isolado por serviço não responde isso. Métrica agregada também não — ela
diz que o p95 subiu, não em qual salto.

## Decisão

**OpenTelemetry** como camada de instrumentação, com:

- auto-instrumentação de HTTP, Express, PostgreSQL e amqplib
- exportação OTLP/HTTP para um **OpenTelemetry Collector**
- Collector exportando para Jaeger
- propagação **W3C Trace Context** (`traceparent`/`tracestate`) em HTTP e nos
  headers das mensagens AMQP
- `ParentBasedSampler` com `TraceIdRatioBased` na raiz
- `traceId` e `spanId` injetados automaticamente em toda linha de log

As aplicações **não conhecem o Jaeger**. Elas falam OTLP com o Collector.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| **Sem tracing** | Inviável: o requisito de rastreabilidade é explícito, e depurar fluxo assíncrono sem trace é adivinhação |
| **SDK proprietário** (Datadog, New Relic) | Melhor experiência pronta, mas amarra a um fornecedor pago. Requisito do projeto: nenhuma dependência de API paga |
| **Cliente Jaeger nativo** | Amarraria a aplicação ao backend. Trocar Jaeger por Tempo exigiria mudar código |
| **OpenCensus** | Descontinuado, absorvido pelo OpenTelemetry |
| **Enviar direto ao Jaeger, sem Collector** | Menos uma peça, mas perde o ponto de desacoplamento: amostragem, enriquecimento e troca de backend passariam a exigir redeploy da aplicação |

## Consequências positivas

- Padrão CNCF, sem amarração a fornecedor
- Auto-instrumentação cobre a maior parte sem código manual
- Collector como ponto de desacoplamento: trocar o backend é configuração
- Correlação log ↔ trace nos dois sentidos, provisionada no Grafana
- Propagação atravessa o broker: o span do consumidor liga ao do produtor

## Consequências negativas

- **Versionamento frágil.** Os pacotes `@opentelemetry/*` experimentais estão
  na linha `0.x` e precisam estar **alinhados entre si**. Uma atualização
  parcial quebra o build de forma pouco óbvia. Por isso o Dependabot agrupa
  todos eles em um único PR
- **API instável.** O pacote `@opentelemetry/resources` mudou a forma de criar
  Resource dentro da própria linha 1.x. O arquivo `tracing.ts` documenta a
  alternativa
- Sobrecarga de CPU e memória por span produzido
- Mais um componente (Collector) para operar

## Riscos

| Risco | Mitigação |
|---|---|
| Collector fora do ar derrubando a aplicação | `initTracing` é **tolerante a falha**: se o SDK não subir, registra aviso e o serviço continua. Perder telemetria é preferível a parar de processar pedidos |
| Express carregado antes da instrumentação, deixando o servidor sem spans | Ponto de entrada dedicado `@loja-veloz/observability/tracing` e `instrumentation.ts` como primeiro import de todo `server.ts` |
| Volume e custo com amostragem em 100% | `OTEL_SAMPLING_RATIO` por ambiente: 1.0 em dev, 0.5 em staging, 0.1 em produção |
| Dado sensível dentro de atributo de span | Nenhum payload é anexado a span; apenas identificadores e nomes de operação |
| Versões desalinhadas quebrando o build | Agrupamento no Dependabot; nota de compatibilidade em `tracing.ts` |

## Critérios de revisão

Reavaliar o backend (não o OpenTelemetry) se o volume de traces tornar o Jaeger
com armazenamento em memória inviável — o caminho natural é Grafana Tempo com
armazenamento em objeto, e a troca é feita no Collector, sem tocar na
aplicação. **Essa possibilidade é precisamente o motivo de o Collector existir
neste desenho.**
