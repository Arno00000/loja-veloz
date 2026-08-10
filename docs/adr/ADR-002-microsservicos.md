# ADR-002 — Arquitetura em microsserviços

**Status:** Aceito · 2026-07-30

## Contexto

O problema declarado da Loja Veloz não é "o sistema está lento". É:
indisponibilidade durante deploys, dificuldade de escalar sob pico, ambientes
inconsistentes e baixa rastreabilidade.

Três desses quatro problemas têm solução em monólito bem operado. Escalar sob
pico, especificamente, tem uma característica: **o gargalo não é uniforme**.
Durante uma campanha, a criação de pedidos e a reserva de estoque disparam,
enquanto a consulta de pagamento permanece estável. Escalar um monólito
significa replicar tudo, inclusive o que não precisa.

O projeto é também acadêmico, com objetivo declarado de demonstrar práticas de
DevOps e cloud-native. Isso é parte do contexto e deve ser dito com franqueza.

## Decisão

Quatro processos independentes: API Gateway, Serviço de Pedidos, Serviço de
Estoque e Serviço de Pagamentos. Cada um com o seu banco lógico, o seu ciclo de
deploy, a sua imagem e a sua escala.

A fronteira segue o **domínio de negócio**, não a camada técnica. Não há
"serviço de banco de dados" nem "serviço de validação" — cada serviço é dono
de um conceito completo.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| **Monólito modular** | Honestamente, seria defensável. Resolveria deploy, ambiente e observabilidade com muito menos complexidade operacional. Foi descartado porque não permite escala independente por domínio e porque o objetivo acadêmico é demonstrar orquestração de serviços distribuídos |
| **Dois serviços** (pedidos+estoque, pagamentos) | Menos complexidade, mas o acoplamento entre pedido e estoque no mesmo processo eliminaria justamente o cenário mais interessante: reserva assíncrona com compensação |
| **Serverless (Lambda)** | Bom encaixe para carga em rajada, mas afastaria o projeto dos objetivos de contêiner e Kubernetes, além de amarrar a arquitetura a um provedor |

## Consequências positivas

- Escala independente: o Estoque, que é o mais disputado sob pico, escala sem
  arrastar os demais
- Isolamento de falha: o Pagamento fora do ar não impede a criação de pedidos,
  porque o fluxo é assíncrono
- Deploy independente: corrigir o Estoque não exige reimplantar o Pagamento
- Fronteiras explícitas: a separação de banco impede que uma consulta
  atravesse domínios "só desta vez"

## Consequências negativas

**Estas são reais e não devem ser minimizadas:**

- **Não há transação distribuída.** Um pedido atravessa três bancos e a
  consistência é eventual. Isso muda a experiência do usuário: o `201 Created`
  significa "aceito", não "confirmado"
- **Depurar ficou mais difícil.** Uma falha pode estar em qualquer um dos
  quatro processos ou no broker. É por isso que tracing distribuído e
  `correlationId` deixaram de ser opcionais
- **Operar quatro processos custa mais** que operar um: quatro imagens, quatro
  pipelines de build, quatro conjuntos de métricas, quatro pontos de falha
- **Latência de rede** onde antes havia chamada de função
- Complexidade de infraestrutura: broker, três bancos, service discovery

## Riscos

| Risco | Mitigação |
|---|---|
| Consistência eventual mal compreendida pelo cliente | Estados explícitos e consulta por `GET /orders/:id`; documentado no README |
| Efeito parcial: estoque reservado e pagamento nunca processado | Timeout e DLQ com alerta; sem Saga completa, é uma limitação assumida |
| "Monólito distribuído": serviços que não podem ser implantados isoladamente | Comunicação apenas por evento versionado; NetworkPolicy proíbe HTTP entre backends |
| Complexidade acima da capacidade da equipe | Escopo deliberadamente pequeno: 4 serviços, 9 eventos, 1 linguagem |

## Critérios de revisão

Sinal de que a decisão foi **errada** e deveria ser revertida para monólito
modular:

- serviços que **sempre** são implantados juntos — indica fronteira errada
- mais tempo gasto em infraestrutura do que em funcionalidade
- incidentes cuja causa raiz é a distribuição em si (ordem de evento,
  duplicata, timeout), não o domínio

Sinal de que a decisão foi **acertada**: um serviço escalando sozinho sob pico,
e deploys de um domínio sem coordenação com os outros.
