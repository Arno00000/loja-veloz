# ADR-009 — GitHub Actions e GitHub Container Registry

**Status:** Aceito · 2026-07-30

## Contexto

O problema declarado inclui **deploys manuais** e **baixa confiança nas
entregas**. A automação precisa cobrir: validação de qualidade, construção de
imagem, varredura de vulnerabilidade, publicação e implantação.

O código já vive no GitHub.

## Decisão

**GitHub Actions** para CI/CD e **GitHub Container Registry (GHCR)** para as
imagens, em três workflows:

| Workflow | Gatilho | Faz |
|---|---|---|
| `ci.yml` | PR e push | lint, format, typecheck, testes unitários e de integração, build, validação de Compose, Kustomize e Terraform |
| `images.yml` | main e tags | build em matriz, Trivy **antes** do push, publicação com tag por SHA |
| `deploy-staging.yml` | `workflow_dispatch` | Job de migration, apply, rollout, smoke, rollback condicional |

Autenticação no GHCR pelo `GITHUB_TOKEN`, com `permissions: packages: write`
declarado apenas onde é necessário.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| **Jenkins** | Exigiria servidor próprio para instalar, atualizar e proteger. Custo operacional desproporcional |
| **GitLab CI** | Excelente, mas o código está no GitHub. Migrar por causa do CI seria inverter a prioridade |
| **CircleCI / Travis** | Mais uma conta, mais um segredo, mais uma integração. Sem ganho sobre o Actions no caso |
| **Docker Hub** | Limite de pulls anônimos e mais um conjunto de credenciais para gerenciar |
| **Amazon ECR** | Bom encaixe com EKS, mas exigiria credencial da AWS já no build, e amarraria as imagens ao provedor |
| **Argo CD (GitOps)** | Modelo superior de deploy — é a evolução indicada. Exige um controlador no cluster e mudança do fluxo para pull. Fora do escopo de 4 semanas |

## Consequências positivas

- Zero infraestrutura de CI para manter
- Integração nativa: PR, checks, aba Security, Environments com revisor
- `GITHUB_TOKEN` é de vida curta, escopo de repositório e rotação automática —
  melhor que um Personal Access Token estático
- GHCR herda a visibilidade e as permissões do repositório
- Cache de camadas por escopo de serviço acelera builds sucessivos
- Resultado do Trivy publicado em formato SARIF na aba Security

## Consequências negativas

- Amarração ao GitHub: migrar para outra plataforma exigiria reescrever os três
  workflows
- Minutos de execução são cobrados acima da cota gratuita
- Runners hospedados ficam fora da rede do cluster: alcançar um cluster privado
  exigiria runner auto-hospedado ou endpoint público
- Deploy no modelo **push**: o pipeline precisa de credencial do cluster. O
  modelo pull (GitOps) evitaria isso

## Riscos

| Risco | Mitigação |
|---|---|
| Segredo exposto em log | Mascaramento automático do Actions; nenhum `echo` de variável sensível; verificação no CI de que não há Secret real versionado |
| Workflow com permissão excessiva | `permissions` declarado explicitamente por workflow, com o mínimo necessário |
| Imagem vulnerável publicada | Trivy roda **antes** do push, sobre a imagem carregada no daemon local |
| Deploy com credencial de cluster no CI | ServiceAccount restrita ao namespace `loja-veloz`; Environment `staging` com revisor obrigatório |
| Action de terceiro comprometida | Todas fixadas por versão maior (`@v4`, `@v6`); fixar por SHA seria mais rigoroso e está registrado como melhoria |
| Deploy falhar por pré-requisito ausente | O workflow **verifica** namespace e Secret antes de aplicar, e falha com mensagem clara |

## Decisão sobre o Trivy: publicar, não bloquear

O `exit-code` do Trivy é `0`: o resultado é publicado, mas não quebra o build.

Isso é deliberado. Uma CVE de imagem base sem correção disponível bloquearia
toda entrega sem ação possível. Sem um processo de exceção, o desfecho previsto
é a equipe desabilitar o scan inteiro — o que é pior do que tê-lo informativo.

`ignore-unfixed: true` pelo mesmo motivo. Trocar para `exit-code: 1` é uma
decisão de política que deve vir acompanhada de um processo de exceção
documentado.

## Critérios de revisão

Migrar para GitOps com Argo CD quando: a frequência de deploy justificar
sincronização contínua, ou houver exigência de que o cluster não aceite
credencial vinda de fora, ou o número de ambientes crescer.

Bloquear o build por CVE quando existir processo de exceção definido e alguém
responsável por avaliá-lo.
