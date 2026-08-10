# Caso concreto: Online Boutique (Google Cloud Platform)

## Nota de verificação

As informações desta análise foram conferidas no repositório oficial
`GoogleCloudPlatform/microservices-demo` e no seu `README.md`, acessados em
**30 de julho de 2026**. Nenhuma característica é afirmada aqui sem constar na
documentação oficial. Onde a informação não pôde ser confirmada, isso está
declarado explicitamente.

---

## 1. Organização responsável e objetivo

O Online Boutique é mantido pelo **Google Cloud Platform**, no repositório
público [`GoogleCloudPlatform/microservices-demo`](https://github.com/GoogleCloudPlatform/microservices-demo).

O próprio README declara o objetivo: demonstrar como desenvolvedores podem
modernizar aplicações corporativas usando produtos do Google Cloud, entre eles
Google Kubernetes Engine (GKE), Cloud Service Mesh, gRPC, Cloud Operations,
Spanner, Memorystore, AlloyDB e Gemini. A aplicação funciona em qualquer
cluster Kubernetes, não apenas no GKE.

Trata-se, portanto, de uma **aplicação de demonstração**, e não de um sistema
em produção comercial. Essa distinção importa: várias decisões dela são
otimizadas para ensinar e para exercitar produtos, não para operar uma loja
real. Reconhecer isso é o que permite aprender com o caso sem copiá-lo
acriticamente.

## 2. Domínio

Comércio eletrônico: o usuário navega por produtos, adiciona ao carrinho e
finaliza a compra. É o mesmo domínio da Loja Veloz, o que torna a comparação
direta e útil.

## 3. Arquitetura

São **11 microsserviços que se comunicam por gRPC**, escritos em linguagens
diferentes:

| Serviço | Linguagem | Responsabilidade (conforme o README oficial) |
|---|---|---|
| `frontend` | Go | Servidor HTTP do site; gera IDs de sessão automaticamente, sem cadastro nem login |
| `cartservice` | C# | Guarda os itens do carrinho no Redis |
| `productcatalogservice` | Go | Lista, busca e devolve produtos a partir de um arquivo JSON |
| `currencyservice` | Node.js | Converte valores entre moedas; é o serviço de maior QPS |
| `paymentservice` | Node.js | Cobra o cartão informado (**simulado**) e devolve um ID de transação |
| `shippingservice` | Go | Estima o custo de frete e envia os itens (**simulado**) |
| `emailservice` | Python | Envia e-mail de confirmação (**simulado**) |
| `checkoutservice` | Go | Recupera o carrinho, monta o pedido e **orquestra** pagamento, frete e notificação |
| `recommendationservice` | Python | Recomenda produtos com base no carrinho |
| `adservice` | Java | Devolve anúncios de texto por palavra de contexto |
| `loadgenerator` | Python/Locust | Gera tráfego contínuo imitando fluxos reais de compra |

O uso de cinco linguagens é deliberado: demonstra que o contrato entre serviços
(Protocol Buffers, disponíveis no diretório `./protos`) é o que importa, e não
a tecnologia interna de cada um.

### Padrão de comunicação — a diferença mais relevante

O `checkoutservice` **orquestra** pagamento, frete e e-mail por chamadas gRPC
**síncronas**. Não há broker de mensagens no desenho padrão da aplicação.

Isso significa que, no Online Boutique, a indisponibilidade do `paymentservice`
faz o checkout falhar na hora, e o usuário vê o erro. É um desenho legítimo —
mais simples de entender, de depurar e de rastrear —, mas acopla a
disponibilidade do checkout à de todos os serviços que ele chama.

## 4. Kubernetes

- Manifests prontos em `./release/kubernetes-manifests.yaml`, aplicados com um
  único `kubectl apply`
- **Kustomize** é usado para variações do deployment: o diretório `/kustomize`
  traz componentes para service mesh, assistente com Gemini, Spanner,
  Memorystore, entre outros
- Funciona em GKE Autopilot, e também em Minikube e kind (documentado no
  guia de desenvolvimento)
- Deploy alternativo por **Terraform**, com instruções no diretório `/terraform`
- **Istio / Cloud Service Mesh** é uma variação opcional, não o padrão

## 5. Observabilidade

O README cita **Cloud Operations** entre os produtos demonstrados, e há uma
variação de deployment específica com tracing do Google Cloud Operations.

**Limitação de verificação:** descrições mais antigas do projeto mencionavam
instrumentação por OpenCensus. O README atual **não menciona OpenCensus**, e
não foi possível confirmar, sem inspecionar o código de cada serviço, qual
biblioteca de instrumentação está em uso hoje. Como o OpenCensus foi
descontinuado e absorvido pelo OpenTelemetry, é plausível que tenha havido
migração — mas **plausível não é verificado**, e por isso a afirmação não é
feita aqui.

## 6. CI/CD

O repositório usa **GitHub Actions**: o README exibe o badge de um workflow
chamado "Continuous Integration - Main/Release", e o diretório
`.github/workflows` tem documentação própria.

## 7. Semelhanças com a Loja Veloz

| Aspecto | Ambos |
|---|---|
| Domínio | Comércio eletrônico com carrinho, pedido e pagamento |
| Estilo | Microsserviços independentes, um processo por responsabilidade |
| Empacotamento | Contêineres, um por serviço |
| Orquestração | Kubernetes |
| Configuração | Kustomize com base e variações/overlays |
| CI/CD | GitHub Actions |
| IaC | Terraform |
| Pagamento | **Simulado**, sem provedor externo real |
| Autenticação | Ausente — o Online Boutique gera sessão automática; a Loja Veloz não tem login |
| Portabilidade | Roda em cluster local e em nuvem |

A coincidência em "pagamento simulado" e "sem autenticação" é reveladora: um
projeto mantido pelo Google, com recursos praticamente ilimitados, chegou às
mesmas simplificações que a Loja Veloz. Isso sugere que essas não são
limitações de um MVP acadêmico apressado, mas escolhas racionais quando o
objetivo é demonstrar arquitetura, e não vender produtos.

## 8. Diferenças

| Aspecto | Online Boutique | Loja Veloz |
|---|---|---|
| **Comunicação entre serviços** | gRPC síncrono; `checkoutservice` orquestra | Eventos assíncronos via RabbitMQ (topic exchange) |
| **Acoplamento temporal** | Alto: pagamento fora do ar derruba o checkout | Baixo: o pedido é aceito e processado quando o serviço voltar |
| **Contrato** | Protocol Buffers | Envelope JSON versionado com schema Zod |
| **Linguagens** | Cinco (Go, C#, Node.js, Python, Java) | Uma (TypeScript), em monorepo |
| **Persistência** | Redis no carrinho; catálogo em arquivo JSON | PostgreSQL com três bancos logicamente separados e Prisma |
| **Estado do pedido** | Sem máquina de estados explícita | Cinco estados com transições validadas em ponto único |
| **Idempotência** | Não aplicável no desenho síncrono | Tabela `processed_events` transacional |
| **Nº de serviços** | 11 | 4 |
| **Nuvem de referência** | Google Cloud | AWS |
| **Escala** | 20,5 mil estrelas, mantido por equipe do Google | Projeto acadêmico de quatro semanas |

## 9. Aprendizados aplicados

**O que foi adotado do caso:**

1. **Kustomize com base e variações.** O Online Boutique valida na prática o
   padrão de manter um conjunto canônico de manifests e derivar ambientes por
   sobreposição, em vez de duplicar YAML. A Loja Veloz usa exatamente isso, com
   três overlays.

2. **Simulação explícita em vez de integração falsa.** Os serviços de
   pagamento, frete e e-mail do Online Boutique são declaradamente `(mock)` no
   próprio README — não fingem ser reais. A Loja Veloz seguiu a mesma
   honestidade: o simulador de pagamento é nomeado como tal, é determinístico e
   pode ser desligado por configuração.

3. **Gerador de carga junto da aplicação.** O `loadgenerator` mostra que gerar
   tráfego realista é parte da entrega, não um extra. A Loja Veloz não entrega
   isso — e a ausência está registrada como limitação, com k6 indicado como
   evolução.

4. **Portabilidade como requisito.** Rodar em kind e em nuvem, sem alteração de
   código, é o que torna o projeto ensinável. A Loja Veloz mantém o mesmo
   princípio: Docker Compose para desenvolvimento, Kustomize para cluster.

**O que foi deliberadamente feito diferente:**

1. **Mensageria em vez de orquestração síncrona.** O contexto do problema da
   Loja Veloz é explícito quanto a picos de tráfego em campanha promocional.
   Sob pico, o desenho síncrono transforma latência em falha em cascata: o
   checkout espera o pagamento, que espera o provedor, e a fila de espera se
   acumula em conexões abertas. O desenho assíncrono aceita o pedido, devolve
   201 imediatamente e absorve a rajada na fila. O custo é consistência
   eventual — o cliente não sabe na hora se o pedido foi confirmado — e é um
   custo que o contexto justifica.

2. **Banco relacional com estado explícito.** Catálogo em arquivo JSON é
   perfeito para demonstração e impossível para operação: não há reserva de
   estoque, não há concorrência, não há transação. A Loja Veloz precisa impedir
   venda dupla sob concorrência, o que exige transação e um UPDATE condicional.

3. **Monorepo em uma linguagem.** Cinco linguagens ensinam que o contrato é o
   que importa; também multiplicam por cinco o esforço de manter build, lint,
   teste e imagem. Para uma equipe pequena com prazo de quatro semanas, o
   monorepo em TypeScript permite compartilhar contratos de evento **em tempo
   de compilação** — um payload fora do contrato quebra o build, não a
   produção.

4. **Ausência de service mesh no MVP.** O Online Boutique oferece Istio como
   variação opcional, não como padrão — o que é, em si, um argumento. A Loja
   Veloz registrou a decisão em ADR-008: mesh resolve mTLS, retry e canary
   ponderado, mas adiciona um plano de controle inteiro para operar. Com quatro
   serviços, o custo supera o benefício.

## 10. O que o caso não permite concluir

Uma aplicação de demonstração não é evidência de comportamento em produção.
O Online Boutique não publica dados de latência sob carga real, não relata
incidentes, não tem SLO declarado. Ele demonstra **como montar**, não **como
opera sob estresse**.

Nenhuma afirmação de desempenho da Loja Veloz se apoia neste caso — e, como
registrado em `docs/limitations-and-roadmap.md`, também não se apoia em teste
de carga próprio, que não foi executado.

---

## Fontes

- [GoogleCloudPlatform/microservices-demo — repositório oficial](https://github.com/GoogleCloudPlatform/microservices-demo) — acesso em 30 jul. 2026
- [README.md do repositório oficial](https://github.com/GoogleCloudPlatform/microservices-demo/blob/main/README.md) — acesso em 30 jul. 2026
- [Guia de desenvolvimento](https://github.com/GoogleCloudPlatform/microservices-demo/blob/main/docs/development-guide.md) — acesso em 30 jul. 2026
