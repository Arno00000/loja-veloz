# Relatório teórico

**Entrega contínua de uma plataforma de pedidos em microsserviços: do Docker Compose ao Kubernetes com observabilidade e CI/CD**

---

## Introdução

A adoção de arquiteturas distribuídas em comércio eletrônico deixou de ser uma
questão puramente tecnológica para se tornar uma decisão de negócio. Quando uma
empresa de médio porte enfrenta indisponibilidade durante implantações,
dificuldade de escalar em períodos de pico e baixa confiança nas entregas, o
problema raramente está em uma única camada: ele atravessa a arquitetura da
aplicação, o modelo de empacotamento, o processo de entrega e a capacidade de
observar o que acontece em produção. Este relatório discute os fundamentos
teóricos que sustentam as decisões tomadas no projeto Pedidos Veloz,
desenvolvido para a empresa fictícia Loja Veloz, e procura explicitar não
apenas o que foi adotado, mas por que cada alternativa foi preferida às demais.

## Microsserviços e suas consequências

A arquitetura de microsserviços propõe decompor uma aplicação em serviços
pequenos, independentes e organizados em torno de capacidades de negócio, cada
um com o seu próprio ciclo de vida e o seu próprio armazenamento. O benefício
mais frequentemente citado é a escala independente: durante uma campanha
promocional, a criação de pedidos e a reserva de estoque disparam enquanto a
consulta de pagamentos permanece estável, e replicar um monólito significaria
escalar também aquilo que não precisa.

É importante, contudo, reconhecer que a decomposição não é gratuita. Ao
distribuir o sistema, abandona-se a transação atômica que um banco único
oferecia. Um pedido que atravessa três serviços atravessa também três
fronteiras transacionais, e a consistência passa a ser eventual. Isso não é um
detalhe de implementação: muda a experiência do usuário, que recebe uma
confirmação de aceite antes de saber se o pedido foi efetivamente confirmado.
Depurar torna-se mais difícil, porque uma falha pode estar em qualquer processo
ou no caminho entre eles, e operar quatro processos custa mais do que operar
um. A literatura registra o risco do chamado monólito distribuído — um conjunto
de serviços que, na prática, precisam ser implantados juntos, acumulando as
desvantagens dos dois modelos sem as vantagens de nenhum.

A fronteira entre serviços, portanto, precisa seguir o domínio de negócio e não
a camada técnica. No projeto, cada serviço é dono de um conceito completo:
pedido, estoque ou pagamento. Não existe um serviço de banco de dados nem um
serviço de validação, porque tais fronteiras produziriam acoplamento em vez de
autonomia.

## Comunicação síncrona e assíncrona

A escolha entre chamada síncrona e evento assíncrono é a decisão mais
consequente em uma arquitetura distribuída, e a que mais determina o
comportamento sob estresse. Na comunicação síncrona, um serviço chama outro e
espera pela resposta; a simplicidade é evidente e a rastreabilidade é
imediata. Sob pico, entretanto, a espera transforma-se em acúmulo de conexões
abertas, e a lentidão de um componente propaga-se para todos que dependem dele
— o padrão conhecido como falha em cascata.

A comunicação assíncrona por mensageria inverte essa dinâmica. O produtor
publica um evento e prossegue; a fila atua como amortecedor entre a taxa de
chegada e a taxa de processamento. A indisponibilidade temporária de um
consumidor deixa de derrubar o produtor, pois a mensagem aguarda na fila. O
custo é a consistência eventual e a necessidade de tratar explicitamente
garantias de entrega.

Nenhum broker realista oferece entrega exatamente uma vez. O que se obtém é
entrega ao menos uma vez, o que implica que a mesma mensagem pode chegar
repetida por reconexão de rede, por reentrega após falha ou por reprocessamento
posterior. A consequência prática é que a idempotência deixa de ser um refinamento
e passa a ser requisito: todo consumidor precisa reconhecer que já processou
determinado evento. O padrão adotado registra o identificador do evento em uma
tabela com restrição de unicidade, dentro da mesma transação que aplica o efeito
de negócio — de modo que ou ambos acontecem, ou nenhum acontece.

Persiste, ainda assim, uma janela entre o commit no banco e a confirmação da
publicação, na qual a falha do processo produz efeito local sem evento
correspondente. O padrão transactional outbox resolve esse problema gravando o
evento na mesma transação e delegando a publicação a um processo de relay. Sua
ausência no projeto foi declarada como limitação, e não disfarçada, porque uma
implementação parcial ofereceria falsa garantia.

## Princípios cloud-native e conteinerização

O conjunto de práticas reunido sob o nome 12-Factor App oferece critérios
concretos para aplicações destinadas a plataformas em nuvem. Três deles
orientaram diretamente o projeto. A configuração deve residir no ambiente e não
no código, o que permite que a mesma imagem seja promovida entre ambientes sem
recompilação. Os processos devem ser sem estado, de modo que qualquer réplica
possa atender qualquer requisição e que a remoção de uma réplica não implique
perda. Os logs devem ser tratados como fluxo de eventos escrito na saída
padrão, cabendo à plataforma — e não à aplicação — decidir como coletá-los,
agregá-los e armazená-los.

A conteinerização materializa esses princípios ao empacotar aplicação e
dependências em uma unidade imutável. O ganho central não é o isolamento em si,
que outras tecnologias já ofereciam, mas a paridade entre ambientes: a imagem
executada na máquina do desenvolvedor é a mesma executada em produção,
eliminando a classe de defeitos que se manifesta apenas em um dos lados. A
construção em múltiplos estágios permite que as ferramentas de compilação
permaneçam fora da imagem final, reduzindo simultaneamente o tamanho e a
superfície de ataque. A execução com usuário sem privilégios administrativos,
por sua vez, limita o alcance de uma eventual execução remota de código.

## Orquestração

Contêineres isolados resolvem o empacotamento, mas não respondem quem os
reinicia quando falham, como são distribuídos entre máquinas, como o tráfego os
alcança ou como sua quantidade acompanha a demanda. O Kubernetes responde a
essas perguntas com um modelo declarativo: descreve-se o estado desejado e um
conjunto de controladores trabalha continuamente para aproximar o estado real
daquele.

Duas construções merecem destaque teórico. A primeira é a distinção entre as
sondas de vivacidade e de prontidão. A sonda de vivacidade responde se o
processo está vivo, e sua falha provoca reinício. A sonda de prontidão responde
se o serviço pode receber tráfego, e sua falha apenas o remove do balanceamento.
Confundi-las produz um efeito destrutivo bem conhecido: verificar o banco de
dados na sonda de vivacidade faz com que uma instabilidade momentânea da
persistência provoque o reinício simultâneo de todas as réplicas de todos os
serviços, transformando uma degradação em indisponibilidade total.

A segunda é a estratégia de atualização gradual. Configurada para tolerar zero
réplicas indisponíveis, ela sobe uma instância nova, aguarda sua prontidão e só
então remove uma antiga, entregando implantação sem interrupção sem exigir
ferramenta adicional. Convém, aqui, uma precisão frequentemente ausente: um
serviço comum do Kubernetes não realiza divisão percentual de tráfego. Duas
implantações atrás do mesmo serviço produzem uma proporção determinada apenas
pela contagem de réplicas, sem controle de peso, análise de métricas ou
promoção automática. Implantação canário ponderada exige ferramentas
específicas, e afirmar o contrário é um equívoco técnico com consequências
operacionais reais.

## Integração e entrega contínuas

A automação da entrega ataca diretamente a baixa confiança nas implantações.
Um pipeline que executa análise estática, verificação de tipos, testes
automatizados, construção de imagem, varredura de vulnerabilidades e validação
de manifestos converte a revisão manual — sujeita a esquecimento e pressão de
prazo — em verificação sistemática.

Duas decisões merecem justificativa teórica. A varredura de vulnerabilidades
deve ocorrer antes da publicação, e não depois, pois escanear uma imagem já
distribuída apenas documenta um problema que já se propagou. E o versionamento
por identificador imutável de commit, em oposição ao uso exclusivo de uma
etiqueta móvel como *latest*, é o que torna possível saber exatamente o que está
em execução e retornar a uma versão anterior — não existe versão anterior de um
ponteiro que sempre aponta para a mais recente.

## Observabilidade

Sistemas distribuídos falham de maneiras que não se antecipam completamente, o
que desloca o esforço da prevenção exaustiva para a capacidade de compreender o
comportamento a partir de sua saída observável. Os três pilares respondem a
perguntas distintas e não substituem uns aos outros. As métricas informam se
algo está acontecendo e permitem alertar sobre tendências, mas não explicam um
caso específico. Os logs detalham uma execução particular, porém não revelam a
árvore de chamadas. Os rastros distribuídos mostram onde o tempo foi consumido
ao longo de uma requisição que atravessa vários processos, mas são amostrados e
não servem como base de alerta.

Uma distinção conceitual relevante separa o identificador de correlação do
contexto de rastreamento. O primeiro identifica uma jornada de negócio e
sobrevive a saltos assíncronos longos e a reprocessamentos; o segundo descreve
uma execução distribuída concreta, com amostragem e medição de tempo. Ambos são
necessários, e tratá-los como sinônimos empobrece o diagnóstico.

Há ainda uma restrição prática de grande importância: a cardinalidade dos
rótulos em sistemas de métricas. Cada combinação distinta de rótulos origina
uma série temporal, de modo que utilizar identificadores de pedido ou de cliente
como rótulo produz crescimento ilimitado e inviabiliza o sistema de coleta. Essa
informação pertence aos logs e aos rastros, projetados para alta cardinalidade.

## Conclusão

As decisões apresentadas não constituem escolhas universalmente corretas, mas
respostas a um contexto específico: prazo curto, equipe pequena, necessidade de
absorver picos previsíveis e ausência de exigência regulatória imediata. Em
outro contexto, um monólito modular bem operado resolveria três dos quatro
problemas relatados com uma fração da complexidade operacional — e reconhecer
isso é parte da honestidade técnica que a engenharia exige.

O valor de uma arquitetura não reside em sua sofisticação, mas na
correspondência entre as suas propriedades e os problemas que precisa resolver,
somada à clareza com que os seus limites são declarados. Uma solução simples e
demonstrável entrega mais do que uma arquitetura elaborada e incompleta, e é
esse critério que orientou a construção do projeto descrito.

---

**Referências:** ver `docs/references.md`.
