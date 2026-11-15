# 01 — Visão de produto

## O problema

Rate limit é uma ferramenta de negação. Quando uma API responde `429 Too Many
Requests`, três coisas acontecem ao mesmo tempo:

1. O cliente legítimo que precisa de volume alto fica sem saída. Não existe
   caminho dentro do protocolo para ele dizer "eu pago por mais".
2. O servidor já gastou recursos para receber, autenticar e recusar a requisição.
   O custo de infraestrutura do tráfego excedente continua existindo, só não gera
   receita.
3. O agente abusivo não é desincentivado. Ele faz backoff, troca de IP, reparte a
   carga entre chaves e volta.

Agentes de IA tornaram esse desenho obsoleto. Um agente autônomo não tem noção de
etiqueta de consumo: ele itera, reprocessa, varre paginação inteira e repete a
mesma chamada porque o raciocínio dele mudou. O volume deixou de ser humano, mas a
política de acesso continua desenhada para humanos — um teto fixo e uma porta
fechada.

## A proposta

AWall troca a porta fechada por um preço. O gateway fica na frente da API
protegida e aplica a seguinte regra:

- Dentro da cota gratuita, a requisição passa normalmente.
- Acima da cota, em vez de `429`, o gateway responde `402 Payment Required` com os
  termos de pagamento do protocolo x402.
- O cliente paga e repete a requisição. O acesso é restabelecido na hora.

A diferença não é cosmética. `429` é um fim de linha; `402` é uma negociação
dentro do próprio HTTP, legível por máquina, que o cliente pode resolver sozinho.

## Os dois tipos de 402

O mesmo 402 carrega mais de uma forma de pagamento no array `accepts`. Isso
permite atender dois perfis de cliente sem bifurcar a API.

### M2M — agente autônomo

O agente tem carteira e autonomia financeira. Ele lê o header
`PAYMENT-REQUIRED`, escolhe o item em USDC na Stellar, assina a autorização e
repete a requisição com o header `PAYMENT-SIGNATURE`. Latência de alguns segundos,
sem intervenção humana, sem cadastro prévio, sem cartão — e sem precisar de token
de gas, porque o facilitator patrocina a taxa.

### Agente assistido

Há uma pessoa operando ou supervisionando o agente. O mesmo 402 oferece, além do
trilho em stablecoin, um trilho em **Pix** com página de checkout. O agente
mostra o QR Code (ou o código copia-e-cola) para a pessoa, que paga pelo banco.
Confirmado o pagamento, o agente repete a requisição e segue o trabalho.

Esse segundo trilho é o que tira o projeto do nicho cripto. No Brasil, a forma
natural de um humano pagar R$ 5 em dez segundos é Pix, não carteira on-chain.

## Por que isso é melhor que vender um plano

O modelo de assinatura obriga o consumidor a prever o consumo e o fornecedor a
cobrar antecipadamente. Um agente não consegue prever: ele descobre quanto precisa
no meio da tarefa. AWall precifica no momento exato da necessidade, na granularidade
da requisição, sem contrato e sem onboarding.

## Precificar o abuso em vez de bloquear

O preço não é fixo. O gateway calcula um escore de abuso por identidade a partir de
sinais de comportamento (rajadas, requisições idênticas repetidas, proporção de
erros, ausência de cache) e usa esse escore como multiplicador de preço.

O efeito é uma inversão útil: tráfego bem comportado paga barato, tráfego abusivo
paga caro. O abuso deixa de ser um problema de segurança a ser contido e passa a
ser um comportamento precificado. Quem insiste em ser abusivo financia a
infraestrutura que consome.

## Métricas de impacto

O dashboard mede exatamente o que a proposta promete:

- **Requisições recuperadas**: quantas requisições teriam sido `429` e foram
  atendidas após pagamento. É a receita que o rate limit descartava.
- **Receita por trilho**: total em USDC (M2M) e em BRL (Pix).
- **Custo de infraestrutura coberto**: estimativa de custo de infraestrutura por
  crédito consumido versus receita arrecadada no período.
- **Escore de abuso e preço médio**: mostra o multiplicador agindo sobre os piores
  consumidores.

## Não é escopo

- Não é um WAF. AWall não tenta classificar requisição maliciosa por assinatura
  nem bloquear ataque de aplicação.
- Não é um substituto de autenticação. Identidade paga complementa a chave de API,
  não a substitui.
- Não protege contra DDoS volumétrico, que precisa ser mitigado antes do gateway.
