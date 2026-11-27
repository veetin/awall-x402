# 06 — Demo e pitch

## O que o júri precisa ver

Os critérios têm peso igual: execução técnica, implementação (arquitetura e
código), impacto e qualidade da apresentação. O vídeo é o único artefato que fala
dos quatro ao mesmo tempo, então ele não é um resumo do projeto — é parte do
projeto.

Uma coisa precisa ficar inequívoca em menos de 30 segundos: **o status code
mudou de 429 para 402, e isso muda quem fica no prejuízo**.

## Roteiro do vídeo (3 minutos)

**0:00–0:25 — O problema, com número na tela.**
Terminal rodando um agente contra uma API comum. O agente estoura a cota e começa
a tomar `429`. Duas frases: o cliente legítimo travou, e o servidor pagou a
infraestrutura das requisições que recusou. Mostrar o contador de 429 subindo.

**0:25–1:10 — Agente autônomo paga sozinho.**
Mesmo agente, agora atrás do AWall. Ele toma `402`. Mostrar o header
`PAYMENT-REQUIRED` decodificado na tela, com os dois itens do `accepts`. O agente
escolhe o item em USDC, assina as auth entries da invocação Soroban e repete a
requisição. Mostrar o `200` com o header `PAYMENT-RESPONSE` e o hash da transação
aberto no stellar.expert. Falar o tempo decorrido e um detalhe que júri técnico
pega: a carteira do agente não tem moeda nativa nenhuma — a taxa é patrocinada pelo
facilitator, o agente só carrega stablecoin. Nenhum humano tocou em nada.

**1:10–2:00 — Agente assistido paga por Pix.**
Segundo agente, com pessoa no circuito. Toma o mesmo `402`. A interface mostra as
duas opções; a pessoa escolhe Pix e aparece o QR Code. Pagamento feito. O agente,
que estava fazendo polling do status, retoma e conclui a tarefa. Dizer em voz alta
que é o mesmo 402 e o mesmo ledger — a diferença está num item do array `accepts`.

**2:00–2:35 — Dashboard: o prejuízo que virou receita.**
Requisições que teriam sido 429 e foram atendidas, receita em USDC e em BRL, e o
escore de abuso de cada identidade com o multiplicador de preço agindo. Uma frase:
tráfego bem comportado paga barato, tráfego abusivo paga caro.

**2:35–3:00 — O que foi construído de protocolo.**
`specs/scheme_pix.md`: o trilho Pix não é um botão pregado ao lado do x402, é um
scheme especificado no formato do próprio protocolo. Fechar com a tese:
capacidade de API como mercado, não como muro.

## Regras de produção

- Áudio limpo importa mais que animação. Gravar narração separada se necessário.
- Terminal com fonte grande. Nada ilegível em tela de celular.
- Todo valor na tela tem que ser real, gerado na gravação. Nenhum número
  decorativo.
- Se o facilitator público oscilar, subir o facilitator local do `@x402/stellar`
  antes de gravar. Em qualquer caso, não encenar liquidação que não aconteceu.
- Ter uma tomada reserva do trilho Pix usando a simulação de pagamento do ambiente
  de teste da AbacatePay.

## Resumo para o painel de submissão

> AWall substitui o `429 Too Many Requests` por `402 Payment Required`. Quando um
> agente de IA excede a cota gratuita de uma API, em vez de ser bloqueado, ele
> recebe os termos de pagamento do protocolo x402 e segue trabalhando depois de
> pagar. Agentes autônomos pagam sozinhos em stablecoin; agentes com humano no
> circuito pagam por Pix, na mesma resposta 402. A liquidação em cripto roda em
> uma rede cripto (Stellar, na demo), com USDC e taxa patrocinada, então o agente não precisa de token de gas.
> O preço reage ao comportamento:
> tráfego abusivo paga mais. O resultado é que o excedente de tráfego, que hoje é
> só custo de infraestrutura descartado, passa a ser receita atribuível.

## Perguntas que vão aparecer, e as respostas

**"Isso não é só um paywall?"**
Um paywall nega acesso a quem não paga. AWall mantém a cota gratuita intacta e
negocia só o excedente, dentro do protocolo HTTP, de forma legível por máquina.
Nenhum cadastro, nenhum contrato, nenhum cartão.

**"Por que um agente pagaria em vez de trocar de IP?"**
Porque o preço do excedente é menor que o custo de contornar: rotação de IP, pool
de chaves e backoff custam engenharia e tempo. E a identidade que paga ganha cota
melhor e preço menor, por ter histórico de bom comportamento.

**"E se o pagamento falhar no meio?"**
O crédito só existe depois da liquidação confirmada, e todo pagamento tem chave de
idempotência. O erro `settlement_pending` do x402 é tratado como não-terminal: o
gateway reconcilia pelo hash da transação em vez de assumir falha.

**"Por que Stellar e não uma EVM?"**
Três razões de engenharia. A taxa é patrocinada pelo facilitator, então o agente
não precisa manter saldo de token de gas, só de stablecoin. A finalidade é de
poucos segundos a custo quase nulo, o que cabe dentro de um 402 sincrono. E o
cliente assina apenas as auth entries da invocação Soroban, sem gastar sequence
number, o que permite muitas liquidações do mesmo agente por ledger.

**"Dá para escalar?"**
Nesta versão, não horizontalmente: o token bucket está em memória e o gateway é
single-instance. O caminho (bucket em Redis com script atômico) está documentado
na arquitetura. Foi um corte consciente de escopo, não um esquecimento.
