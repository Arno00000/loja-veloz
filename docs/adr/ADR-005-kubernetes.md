# ADR-005 — Kubernetes como plataforma de orquestração

**Status:** Aceito · 2026-07-30

## Contexto

Quatro serviços conteinerizados precisam de: reinício automático em falha,
escala horizontal sob pico, deploy sem indisponibilidade, distribuição de
tráfego, gestão de configuração e segredo, e limites de recurso.

Cada um desses itens tem solução isolada. O que se busca é uma plataforma que
resolva todos de forma coerente, e que seja transferível entre o cluster local
do desenvolvedor e a nuvem.

## Decisão

**Kubernetes**, com manifests autorais em Kustomize e componentes de terceiros
instalados por Helm com valores versionados.

Amazon EKS como referência de nuvem, provisionado por Terraform. kind, minikube
ou Docker Desktop no ambiente local, com o mesmo conjunto de manifests
derivado por overlay.

## Alternativas consideradas

| Alternativa                       | Por que não                                                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Docker Compose em produção**    | Sem escala horizontal automática, sem reagendamento em outro nó, sem rolling update com controle de disponibilidade, sem gestão de segredo. Serve para desenvolvimento — e é exatamente para isso que é usado aqui |
| **Docker Swarm**                  | Mais simples e suficiente para o caso, mas com ecossistema estagnado. Investir aprendizado nele em 2026 tem retorno duvidoso                                                                                       |
| **AWS ECS Fargate**               | Solução legítima, menos complexa que EKS e sem nós para gerenciar. Descartado por amarrar ao provedor e por não rodar no ambiente local — o que quebraria a paridade entre ambientes                               |
| **PaaS (Heroku, Render, Fly.io)** | Resolveria deploy e escala com uma fração do esforço. Descartado porque o objetivo declarado inclui demonstrar orquestração, e porque a Loja Veloz precisa de controle sobre rede e política de segurança          |

## Consequências positivas

- Reinício, reagendamento e autocura sem intervenção
- Rolling update com `maxUnavailable: 0` — deploy sem indisponibilidade
- HPA para picos de campanha
- Probes com semântica distinta (liveness, readiness, startup) — a base do
  deploy seguro deste projeto
- NetworkPolicy transforma decisão de arquitetura em restrição efetiva
- Pod Security Standards aplicados por label de namespace
- Portabilidade: os mesmos manifests em kind e em EKS

## Consequências negativas

- **Curva de aprendizado severa.** Kubernetes tem dezenas de conceitos que
  precisam ser entendidos antes de operar com segurança
- Muitas peças móveis: Ingress Controller, Metrics Server, CNI com suporte a
  NetworkPolicy — nenhuma vem pronta
- Diagnóstico exige familiaridade: `CrashLoopBackOff`, `ImagePullBackOff`,
  `Pending` por quota são sintomas que não se explicam sozinhos
- Custo: um control plane EKS é cobrado por hora, ocioso ou não
- Excesso de capacidade para quatro serviços de baixo tráfego

## Riscos

| Risco                                                      | Mitigação                                                                                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| NetworkPolicy silenciosamente ignorada por CNI sem suporte | Aviso explícito em `kubernetes/README.md` com comando de verificação                                                                          |
| HPA parado por ausência de Metrics Server                  | Documentado como pré-requisito; sintoma descrito em `docs/troubleshooting.md`                                                                 |
| Configuração de segurança relaxada "para o pod subir"      | Regra declarada: nenhum controle é desligado em serviço da aplicação. As duas exceções (Postgres e RabbitMQ locais) estão marcadas no arquivo |
| Complexidade acima da capacidade da equipe                 | Runbook e troubleshooting com sintoma, diagnóstico e correção                                                                                 |
| Custo inesperado na AWS                                    | Avisos de custo em `terraform/README.md`; NAT desligado por padrão                                                                            |

## Critérios de revisão

Se a operação do cluster consumir mais esforço do que a evolução do produto, a
decisão está errada para o contexto. Nesse caso, EKS Auto Mode, ECS Fargate ou
uma PaaS entregam o mesmo resultado de negócio com menos superfície
operacional.
