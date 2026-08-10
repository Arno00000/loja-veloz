# ADR-006 — Rolling Update como estratégia de deploy

**Status:** Aceito · 2026-07-30

## Contexto

O problema declarado inclui **indisponibilidade durante deploys**. Resolver
isso é requisito, não melhoria.

Há uma armadilha comum aqui: apresentar "canary" implementado como dois
Deployments atrás do mesmo Service. Isso **não é canary**. Um Service comum do
Kubernetes distribui entre todos os pods que casam com o selector; a proporção
resultante é apenas o número de pods de cada versão, sem controle percentual,
sem análise de métrica e sem promoção automática.

## Decisão

**Rolling Update** como estratégia única, configurada com:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0
```

Acompanhada de: `readinessProbe` que consulta dependências, `startupProbe` com
tolerância de até 90 s, `terminationGracePeriodSeconds` de 30–45 s,
`preStop: sleep 5`, PodDisruptionBudget e graceful shutdown na aplicação.

`maxUnavailable: 0` é o ponto central: a capacidade **nunca** cai abaixo do
declarado. O Kubernetes sobe um pod novo, espera o readiness passar, e só então
derruba um antigo.

## Alternativas consideradas

| Alternativa                       | Por que não                                                                                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recreate**                      | Derruba tudo antes de subir o novo. É exatamente o problema que se quer resolver                                                                                                 |
| **Blue/Green**                    | Zero indisponibilidade e rollback instantâneo, mas exige capacidade dobrada durante a transição e uma camada de roteamento para a troca. Custo alto para o ganho, com 4 serviços |
| **Canary com Argo Rollouts**      | É o que se faria com mais prazo. Exige instalar e operar um controlador adicional, definir métricas de análise e limiares de promoção. Fora do escopo de 4 semanas               |
| **Canary com Istio**              | Idem, com um plano de controle inteiro junto. Ver ADR-008                                                                                                                        |
| **"Canary" com dois Deployments** | **Rejeitado explicitamente por ser falso.** Não faz divisão ponderada                                                                                                            |

## Consequências positivas

- Deploy sem indisponibilidade, sem ferramenta além do Kubernetes
- Rollback nativo: `kubectl rollout undo`
- Histórico de revisões consultável
- Funciona igual em kind e em EKS
- PDB protege durante drenagem de nó

## Consequências negativas

- **Sem exposição gradual.** Uma versão ruim atinge 100% do tráfego assim que o
  rollout termina. A detecção depende do smoke test e do alerta, não da
  estratégia
- Rollout mais lento que Recreate, por definição
- Convivência entre versões durante a transição: por alguns segundos, pods da
  versão antiga e da nova processam a mesma fila. **Isso exige que os eventos
  sejam compatíveis entre versões adjacentes** — daí a regra de nunca alterar
  payload sem nova versão
- **Rollback não desfaz migration.** Reverter o Deployment com um schema já
  alterado pode ser pior que o estado atual

## Riscos

| Risco                                                       | Mitigação                                                                                                   |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Tráfego para pod que já começou a encerrar (502 esporádico) | `preStop: sleep 5` — a remoção dos endpoints e o SIGTERM acontecem em paralelo                              |
| Pod recebendo tráfego antes de estar pronto                 | `readinessProbe` consulta banco e broker                                                                    |
| Processo morto durante partida lenta                        | `startupProbe` suspende liveness e readiness por até 90 s                                                   |
| Mensagem perdida ao encerrar                                | Graceful shutdown: cancela consumo, termina o que está em voo, confirma, e só então fecha                   |
| Rollback com migration destrutiva                           | Regra _expand and contract_; workflow **não** faz rollback automático quando houve migration, e emite aviso |

## Critérios de revisão

Adotar canary de verdade (Argo Rollouts ou Flagger) quando: a frequência de
deploy aumentar a ponto de o smoke test não bastar, ou um incidente for causado
por versão ruim atingindo 100% do tráfego, ou houver SLO formal a proteger.
