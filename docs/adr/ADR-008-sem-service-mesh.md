# ADR-008 — Ausência inicial de service mesh

**Status:** Aceito · 2026-07-30

## Contexto

Um service mesh (Istio, Linkerd) resolveria, sem alterar código da aplicação:
mTLS automático entre serviços, retry e timeout no nível da malha, circuit
breaker, divisão ponderada de tráfego para canary, e telemetria L7 uniforme.

Vários desses itens aparecem como limitação em outros ADRs deste projeto. É
tentador concluir que o mesh é a resposta.

## Decisão

**Não adotar service mesh no MVP.** As necessidades são atendidas por
alternativas mais simples:

| Necessidade              | Solução adotada                                              |
| ------------------------ | ------------------------------------------------------------ |
| Segmentação de rede      | NetworkPolicy com negação por padrão                         |
| Timeout entre serviços   | `AbortSignal.timeout` no cliente do Gateway                  |
| Retry                    | Política própria no consumidor, com DLQ e teto de tentativas |
| Telemetria               | OpenTelemetry na aplicação                                   |
| Rate limiting            | `express-rate-limit` no Gateway + annotation no Ingress      |
| Criptografia em trânsito | TLS no Ingress; **tráfego interno em texto claro**           |

## Alternativas consideradas

| Alternativa                 | Por que não agora                                                                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Istio**                   | Plano de controle completo, sidecar por pod, CRDs próprios. Consumo de recurso e superfície operacional desproporcionais a 4 serviços em 4 semanas                            |
| **Linkerd**                 | Significativamente mais leve e simples que Istio, e a escolha provável quando o mesh for adotado. Ainda assim, é um componente a mais para instalar, atualizar e diagnosticar |
| **Cilium com service mesh** | Resolveria NetworkPolicy e mesh na mesma camada, sem sidecar. Interessante, mas exigiria trocar o CNI do cluster                                                              |
| **Adotar mesh**             | Rejeitado por custo/benefício, não por desconhecimento                                                                                                                        |

## Consequências positivas

- Menos um plano de controle para instalar, atualizar e diagnosticar
- Sem sidecar: menos CPU, menos memória, menos latência por salto
- Menos conceitos entre o problema e a causa raiz durante um incidente
- Comportamento de retry explícito **no código**, versionado e testado
  (`retry-policy.test.ts`) em vez de configurado em CRD

## Consequências negativas

**Estas são as lacunas reais:**

- **Sem mTLS.** O tráfego entre Gateway e serviços trafega em texto claro
  dentro do cluster. Quem conseguir capturar tráfego na rede do cluster lê o
  conteúdo. A NetworkPolicy limita **quem alcança**, não **o que se lê**
- **Sem canary ponderado.** Confirmado em ADR-006 como limitação assumida
- **Sem circuit breaker.** Um serviço lento continua recebendo requisições até
  o timeout de cada uma
- Retry e timeout precisam ser implementados e testados em cada cliente
- Telemetria L7 depende de a aplicação estar instrumentada — se alguém
  esquecer, não há malha para cobrir

## Riscos

| Risco                              | Mitigação                                                | Residual                                                |
| ---------------------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| Tráfego interno interceptado       | NetworkPolicy restringe origem; cluster privado          | **Sim, assumido.** Registrado em `docs/threat-model.md` |
| Falha em cascata por serviço lento | Timeout de 5 s no Gateway; fluxo de negócio é assíncrono | Baixo — o desenho por evento já isola a maior parte     |
| Retry inconsistente entre clientes | Política centralizada em `packages/messaging`            | Baixo                                                   |

## Critérios de revisão

Adotar mesh — provavelmente **Linkerd**, pela simplicidade — quando ocorrer
qualquer um destes:

- exigência regulatória ou de auditoria de criptografia em trânsito interno
- número de serviços passar de ~10, tornando inviável manter política de retry
  e timeout consistente em cada cliente
- necessidade real de canary ponderado com análise automática
- necessidade de circuit breaker por dependência

**Contraindicação explícita:** adotar mesh apenas para "ter observabilidade" é
um erro. O OpenTelemetry já entrega isso, com mais contexto de negócio do que
a malha conseguiria inferir.
