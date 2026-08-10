# Relatório prático

**Projeto Pedidos Veloz — Loja Veloz**

---

## Aviso preliminar sobre validação

Este relatório descreve o que foi **construído**. Ele não afirma o que foi
**executado**.

O ambiente em que o projeto foi desenvolvido não dispôs de terminal Linux
funcional nem de acesso a `npm`, `docker`, `kubectl` ou `terraform`. Em
consequência, **nenhum comando foi executado durante a construção**. Todos os
arquivos estão validados por inspeção; a validação por execução depende do
ambiente do leitor e está registrada na seção 15 como pendente.

Essa declaração precede o restante do texto de propósito. Um relatório que
descreve resultados de execução que não ocorreram é ficção, por mais correto
que o código esteja.

## 1. O problema

A Loja Veloz cresceu rapidamente em doze meses e acumulou um conjunto de
problemas operacionais que se reforçam mutuamente: indisponibilidade durante
implantações, dificuldade de escalar em picos, implantações manuais, ambientes
inconsistentes entre desenvolvedores, baixa rastreabilidade de falhas, ausência
de observabilidade centralizada, configuração dispersa, credenciais tratadas de
forma inadequada e dificuldade de reproduzir a infraestrutura.

Uma campanha promocional se aproxima, com previsão de aumento de tráfego, e o
prazo de entrega é de quatro semanas.

Os problemas relatados não são independentes. Ambientes inconsistentes tornam a
implantação arriscada; a implantação arriscada é feita com pouca frequência; a
baixa frequência aumenta o tamanho de cada entrega, o que torna a implantação
ainda mais arriscada. A ausência de observabilidade fecha o ciclo, porque
impede aprender com cada incidente.

## 2. A solução em uma frase

Uma plataforma de pedidos em quatro microsserviços conteinerizados, comunicando-se
por eventos, com infraestrutura declarada em código, entrega automatizada e
telemetria nos três pilares desde o primeiro commit.

## 3. Arquitetura

Quatro aplicações compõem a solução. O **API Gateway** é a única superfície
pública: gera ou propaga o identificador de correlação, aplica limitação de
taxa e política de origem cruzada, encaminha chamadas e padroniza erros — sem
acessar banco nem implementar regra de negócio. O **Serviço de Pedidos** é o
único componente autorizado a alterar o estado de um pedido. O **Serviço de
Estoque** mantém as quantidades disponíveis e reservadas. O **Serviço de
Pagamentos** simula a autorização e registra o resultado.

A fronteira entre os serviços segue o domínio de negócio. Não existe um serviço
de banco de dados nem um serviço de validação, porque tais fronteiras produzem
acoplamento em vez de autonomia.

`[Inserir Figura 1 — Diagrama de arquitetura geral, disponível em docs/architecture.md §2]`
_Legenda sugerida: visão geral dos componentes, evidenciando que o Gateway não
acessa banco e que não há comunicação HTTP entre serviços de backend._

## 4. Dados

Adotou-se uma instância PostgreSQL com três bancos e três usuários distintos —
`orders_db`, `inventory_db` e `payments_db` —, cada serviço com o seu próprio
esquema Prisma, as suas próprias migrações e permissão exclusiva no seu banco.

A escolha é de economia operacional, não recomendação de arquitetura. O
isolamento que importa para a fronteira arquitetural — de esquema e de
credencial — está preservado, e a migração para instâncias separadas não exige
alterar código, apenas as três URLs de conexão. O que essa escolha não entrega
está declarado: isolamento de falha, isolamento de recursos e escala
independente por domínio.

Cada banco possui a tabela `processed_events`, com o identificador do evento
como chave primária, cuja função é discutida na seção 6.

`[Inserir Figura 2 — Modelo entidade-relacionamento, disponível em docs/architecture.md §7]`
_Legenda sugerida: entidades por serviço, com destaque para as restrições de
unicidade que sustentam a idempotência._

## 5. Estado do pedido

Cinco estados e quatro transições válidas. De `PENDING` parte-se para
`STOCK_RESERVED` ou `STOCK_FAILED`; de `STOCK_RESERVED`, para `CONFIRMED` ou
`PAYMENT_FAILED`. Os três últimos são terminais.

A validação está centralizada em uma única função, `assertTransition`, no
pacote compartilhado. Uma transição inválida — evento fora de ordem ou recebido
após o estado terminal — é **absorvida**, registrada em log e contabilizada em
métrica, e deliberadamente **não** enviada para reprocessamento: ela produziria
o mesmo resultado em toda nova tentativa.

`[Inserir Figura 3 — Diagrama de estados, disponível em docs/architecture.md §5]`
_Legenda sugerida: transições permitidas; note que `stock.released` não altera
o estado terminal `PAYMENT_FAILED`._

## 6. Mensageria

Utiliza-se um exchange do tipo _topic_, durável, com nove tipos de evento cuja
chave de roteamento é idêntica ao campo `eventType` do envelope — os três
significados vivem no mesmo literal, o que elimina uma classe inteira de erros
de configuração entre produtores e consumidores.

O tratamento de falhas foi construído com recursos nativos do broker. Cada fila
de consumo possui uma fila espelho de reprocessamento, com tempo de vida
configurado e encaminhamento para o exchange padrão usando o nome da fila
original como chave — o que devolve a mensagem ao consumidor que falhou, após o
atraso, sem depender de plugins externos. Esgotadas as tentativas, a mensagem
segue para uma fila morta, para inspeção.

O contrato de confirmação é rigoroso: a mensagem só é confirmada após
processamento bem-sucedido ou após republicação **confirmada** na fila de
reprocessamento ou na fila morta. A devolução ao broker com reenfileiramento é
reservada ao único caso em que nem a republicação funciona.

Payloads que violam o contrato — JSON inválido, tipo de evento desconhecido ou
esquema incompatível — seguem diretamente para a fila morta, sem
reprocessamento, pois não se tornarão válidos em nova tentativa.

O projeto não promete entrega exatamente uma vez. A defesa contra duplicação é
o registro do identificador do evento na mesma transação que aplica o efeito de
negócio.

`[Inserir Figura 4 — Topologia do RabbitMQ, disponível em docs/architecture.md §6]`
_Legenda sugerida: três exchanges, seis filas de consumo e o caminho de
reprocessamento com atraso._

## 7. Contêineres e ambiente local

Cada aplicação possui um Dockerfile com construção em múltiplos estágios sobre
`node:22-bookworm-slim`. A escolha da imagem baseada em Debian, e não Alpine,
decorre da compatibilidade com os binários do Prisma e com o OpenSSL. O
contexto de construção é sempre a raiz do monorepo, pois a compilação depende
do arquivo de bloqueio de dependências e dos pacotes compartilhados.

As imagens executam com usuário sem privilégios administrativos e possuem
verificação de saúde baseada no `fetch` nativo do Node — instalar um cliente
HTTP apenas para essa finalidade aumentaria a superfície de ataque sem
necessidade. A forma de execução em modo _exec_ garante que o processo Node
receba o sinal de término diretamente, o que é o que torna o encerramento
ordenado efetivamente acionável.

O ambiente local sobe com um único comando e inclui doze serviços. As migrações
são executadas por serviços dedicados que rodam uma vez e terminam, liberando a
subida das aplicações — desenho que espelha a prática de produção melhor do que
um ponto de entrada que migra e sobe no mesmo processo.

`[Inserir Figura 5 — Saída de `docker compose ps` com todos os serviços saudáveis]`
_Legenda sugerida: estado dos contêineres após a subida completa da stack._

## 8. Kubernetes

Os manifestos autorais estão em Kustomize, com uma base e três sobreposições.
Os componentes de terceiros são instalados por Helm, com valores versionados.
A divisão é deliberada: copiar manifestos gerados por charts oficiais para o
repositório tornaria a atualização impossível.

Todos os pods atendem ao padrão de segurança mais restritivo — execução sem
privilégios administrativos, sem escalonamento de privilégio, sistema de
arquivos raiz somente leitura, todas as capacidades removidas e perfil seccomp
padrão —, aplicado por rótulo no namespace. As duas exceções, no banco e no
broker do ambiente de desenvolvimento, estão marcadas no próprio arquivo com a
justificativa. Nenhum controle foi desligado em serviço da aplicação para
"fazer o contêiner subir".

As políticas de rede negam todo o tráfego por padrão e abrem apenas o
necessário. O que não está autorizado é tão significativo quanto o que está:
nenhuma regra permite comunicação HTTP entre serviços de backend, o que
converte a decisão arquitetural em restrição efetiva de rede.

`[Inserir Figura 6 — Saída de `kubectl get pods -n loja-veloz` com todos os pods prontos]`
_Legenda sugerida: réplicas em execução no cluster._

## 9. Estratégia de implantação

Adotou-se atualização gradual com tolerância de zero réplicas indisponíveis. O
Kubernetes sobe uma instância nova, aguarda sua prontidão e só então remove uma
antiga.

Três detalhes tornam isso efetivo. A sonda de prontidão consulta banco e
broker, de modo que um pod não recebe tráfego antes de poder atendê-lo. A sonda
de inicialização suspende as demais por até noventa segundos, evitando que uma
partida lenta seja confundida com travamento. E a pausa de cinco segundos antes
do encerramento resolve uma corrida real: a remoção do pod dos endpoints e o
envio do sinal de término ocorrem em paralelo, e sem essa pausa o proxy ainda
pode encaminhar requisições a um pod que já iniciou o desligamento.

Implantação canário ponderada **não foi entregue**, e o motivo é técnico: um
serviço comum do Kubernetes não realiza divisão percentual de tráfego. Dois
Deployments atrás do mesmo serviço não constituem canário. Entregar isso como
se fosse seria um equívoco com consequências operacionais.

O retorno à versão anterior é nativo, com uma ressalva importante: ele não
desfaz migrações de banco. O fluxo de implantação em _staging_ **não** executa
retorno automático quando houve migração, e emite aviso orientando o
procedimento manual.

## 10. Escalabilidade

Utiliza-se o autoescalador horizontal por utilização de CPU, com limites
distintos por serviço. O Gateway escala até dez réplicas; os serviços com banco,
até oito. A diferença não é arbitrária: **o teto real de escala não é CPU, é o
número máximo de conexões do PostgreSQL**. Cada réplica abre até dez conexões, e
ignorar esse fato apenas trocaria um gargalo de processamento por um de
persistência.

Reconhece-se que CPU é uma métrica inadequada para consumidores de fila: um
acúmulo de mensagens não necessariamente se manifesta como CPU alta, e o
sistema escalaria tarde. A adoção de escala por profundidade de fila está
registrada como evolução prioritária.

## 11. Observabilidade

Os três pilares foram implementados. As métricas são expostas por endpoint
próprio e coletadas por raspagem. Os logs são JSON estruturado escrito na saída
padrão, coletados por agente e enviados a um agregador. Os rastros são
exportados via OTLP para um coletor, que os encaminha ao backend — as
aplicações não conhecem o backend de rastreamento, o que permite trocá-lo por
configuração.

Duas decisões merecem registro. A primeira é a distinção entre identificador de
correlação e contexto de rastreamento: o primeiro identifica a jornada de
negócio e sobrevive a saltos assíncronos e reprocessamentos; o segundo descreve
uma execução concreta e é amostrado. Ambos aparecem em toda linha de log.

A segunda é a regra de cardinalidade: identificadores de pedido, cliente ou
evento **nunca** são rótulos de métrica. Cada combinação distinta cria uma série
temporal, e identificadores criariam séries sem limite. A normalização de rota
converte caminhos com identificador no padrão registrado no roteador.

A correlação entre logs e rastros está provisionada nos dois sentidos, o que
permite partir de uma linha de erro e chegar ao rastro correspondente com um
clique.

`[Inserir Figura 7 — Painel "Pedidos Veloz - Visão Geral" no Grafana]`
_Legenda sugerida: taxa de requisições, latência por percentil, fluxo de
pedidos e estado da mensageria._

`[Inserir Figura 8 — Rastro completo de um pedido no Jaeger]`
_Legenda sugerida: propagação do contexto do Gateway até a atualização final,
atravessando o broker._

## 12. Segurança

Aplicaram-se: execução sem privilégios administrativos, imagens mínimas,
dependências fixadas por arquivo de bloqueio, varredura de vulnerabilidades
antes da publicação, limitação de taxa, cabeçalhos de segurança, política de
origem cruzada restrita por configuração, validação de esquema em toda entrada,
limite de tamanho de corpo, tempo limite entre serviços, tratamento de erro que
não vaza informação interna, redação automática de campos sensíveis nos logs,
contas de serviço sem montagem de token, políticas de rede, padrão de segurança
de pods, segredos fora do repositório e permissões mínimas no pipeline.

O modelo de ameaças documenta quinze ameaças com controles e **risco residual
declarado**. Duas merecem destaque neste relatório por serem bloqueadoras para
uso real: a ausência completa de autenticação nas APIs, e a ausência de
expiração de reservas de estoque, que combinadas permitem esgotar o estoque com
pedidos que nunca serão pagos.

Registra-se explicitamente que a codificação Base64 utilizada em segredos do
Kubernetes **não é criptografia**, sendo reversível trivialmente. As proteções
reais dependem de controle de acesso e de criptografia em repouso, nenhuma das
quais é configurada por este projeto.

## 13. Entrega contínua

Três fluxos de trabalho compõem o pipeline. O primeiro executa análise
estática, verificação de formatação, verificação de tipos, testes unitários e
de integração, construção, e validação de composição, manifestos e
infraestrutura como código — os dois últimos sem necessidade de credencial de
nuvem. O segundo constrói as quatro imagens em matriz, executa a varredura de
vulnerabilidades **antes** da publicação e publica com etiqueta derivada do
identificador do commit. O terceiro implanta em _staging_, com verificação
prévia de pré-requisitos, execução de migrações como tarefa dedicada,
acompanhamento da atualização, testes de fumaça e retorno condicional.

O versionamento por identificador imutável, em vez do uso exclusivo de uma
etiqueta móvel, é o que permite saber o que está em execução e retornar a uma
versão anterior — não existe versão anterior de um ponteiro que sempre aponta
para a mais recente.

## 14. Infraestrutura como código

Três módulos Terraform — rede, cluster e banco — compõem dois ambientes. O de
_staging_ prioriza custo reduzido, com instâncias interrompíveis, sem gateway
de tradução de endereços e com banco em zona única. O de produção usa três
zonas, instâncias sob demanda, redundância de zona no banco e proteção contra
exclusão.

Os avisos de custo são explícitos e nenhum valor monetário é informado — preços
variam por região e por conta, e publicar números seria inventar dado. A senha
do banco é gerada pela ferramenta e armazenada em gerenciador de segredos,
registrando-se que ela **também** permanece no arquivo de estado em texto
claro, o que é precisamente o motivo pelo qual o armazenamento remoto de estado
precisa de criptografia e acesso restrito.

## 15. Resultados e estado de validação

O que foi construído: 8 workspaces, 4 aplicações conteinerizadas, 9 tipos de
evento com esquema e testes, 6 filas com reprocessamento e fila morta, cerca de
150 casos de teste unitário, 6 blocos de teste de integração contra a stack
real, 13 manifestos base com 3 sobreposições, 3 fluxos de CI/CD, 3 módulos
Terraform, 12 registros de decisão arquitetural, e documentação operacional com
29 problemas catalogados.

O que **não** foi validado, e precisa ser executado pelo leitor:

| Comando                                         | Estado                                                     |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `npm install`                                   | **PENDENTE DE EXECUÇÃO** — gera o arquivo de bloqueio real |
| `npm run lint` / `format:check` / `typecheck`   | **PENDENTE DE EXECUÇÃO**                                   |
| `npm run test`                                  | **PENDENTE DE EXECUÇÃO**                                   |
| `npx prisma migrate dev --name init` (×3)       | **PENDENTE DE EXECUÇÃO** — gera as migrações               |
| `docker compose config` / `up --build`          | **PENDENTE DE EXECUÇÃO**                                   |
| `npm run test:integration`                      | **PENDENTE DE EXECUÇÃO**                                   |
| `kubectl kustomize` / `apply --dry-run`         | **PENDENTE DE EXECUÇÃO**                                   |
| `terraform fmt` / `validate` / `plan` / `apply` | **PENDENTE DE EXECUÇÃO**                                   |

Todo o restante encontra-se **VALIDADO POR INSPEÇÃO**: coerência de importações,
caminhos, scripts, dependências, portas, nomes de serviços, bancos, usuários,
URLs de conexão, filas, exchanges, chaves de roteamento, eventos, variáveis,
sondas, métricas, imagens, sobreposições, namespaces e fluxos de trabalho.

Recomenda-se que o leitor execute os comandos na ordem apresentada e substitua
cada `PENDENTE DE EXECUÇÃO` por `VALIDADO POR EXECUÇÃO`, registrando a
evidência.

## 16. Limitações

As mais relevantes: pagamento simulado; instância única de banco no ambiente
local; ausência de transactional outbox, com janela residual entre o commit e a
publicação; ausência de malha de serviços e, portanto, de criptografia mútua
entre serviços; **ausência completa de autenticação**; ausência de expiração de
reserva de estoque; cargas com estado simplificadas no cluster local; ausência
de alta disponibilidade real do banco; **ausência de teste de carga** — motivo
pelo qual nenhuma afirmação de desempenho neste projeto é sustentada por dados
medidos; dependência de cluster para a implantação em _staging_; e Terraform
não aplicado.

A lista completa, com motivo e consequência de cada item, está em
`docs/limitations-and-roadmap.md`.

## 17. Conclusão

O projeto demonstra um caminho completo do desenvolvimento local à
infraestrutura de nuvem, com automação de entrega e telemetria desde o início.
As decisões foram tomadas privilegiando implementações simples e demonstráveis
sobre arquiteturas sofisticadas e incompletas, e cada uma está registrada com
suas alternativas, consequências negativas e critérios de revisão.

O resultado mais defensável deste trabalho, contudo, não é a arquitetura em si.
É a disciplina de declarar o que **não** foi entregue: o canário que não é
canário, a garantia de entrega que não é exatamente uma vez, a codificação que
não é criptografia, o desempenho que não foi medido e os comandos que não foram
executados. Uma entrega que se apresenta como mais completa do que é transfere
ao próximo operador o custo de descobrir a diferença — e esse custo costuma ser
cobrado no pior momento possível.
