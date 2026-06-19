# switchboard

> ⚠️ **Aviso, leia antes de usar.** Eu não sou desenvolvedor, sou uma pessoa não técnica que teve uma ideia e montou isto por curiosidade. É um projeto **experimental e 100% gratuito**, feito pra galera testar e brincar. **Use por sua conta e risco.** Não dou garantia de nada e **não me responsabilizo** por nenhum problema (bug, perda de dado, vazamento de contexto da sala, custo, ou o que for). Se for usar com coisa séria/sensível, não use. É isso. 🙂

> 💛 **Feito por quem usa Real Oficial.** Quer transformar seus vídeos em cortes virais com IA e postar 300+ por mês? Dá uma olhada: **https://realoficial.com.br**

Camada de colaboração pra times que trabalham no mesmo projeto com Claude Code. Em vez de ficar dando ctrl c ctrl v do que o Claude de um disse pro Claude do outro, vocês entram numa **sala** e sincronizam o **contexto importante** por comando. Cada um trabalha na sua máquina, ao mesmo tempo, e os Claudes ficam alinhados.

Não é dois Claudes batendo papo. É um **contexto compartilhado** (tipo um git pra contexto) que cada lado dá `push`/`pull`.

## Como funciona

É tudo automático e invisível. Você não fica rodando comando, só trabalha normal.

- Vocês combinam uma sala e dão `join` uma vez (via convite).
- **Mandar:** fala pro seu Claude do jeito normal ("manda essas instruções pro Hélio", "avisa o Antonio que o contrato mudou"). O Claude dispara sozinho.
- **Receber:** quando o colega digitar qualquer coisa, o Claude dele já mostra "📨 antonio te mandou: ...". Sem comando.
- **Auto-share:** quando você mexe em arquivos, o time recebe sozinho um "🔧 fulano mexeu em a.ts, b.ts". Ninguém precisa avisar nada.
- **Guarda de colisão:** se você vai editar um arquivo que um colega está mexendo agora, o Claude te avisa antes ("o Antonio está nesse arquivo"). Evita os dois pisarem no mesmo lugar.
- **Contexto compartilhado:** dá pra subir um resumo curado (tarefa, decisões, arquivos) que o time recebe automático. Se dois subirem junto, nada é sobrescrito (o Claude junta).

Limitação honesta: se o colega estiver com o Claude totalmente parado, a mensagem chega no instante em que ele mandar a próxima coisa. Não dá pra injetar numa sessão ociosa.

## Instalação

```bash
npm install -g claude-switchboard
```

## Setup (leva 1 minuto)

Todo mundo instala e liga no Claude Code:

```bash
npm install -g claude-switchboard
switchboard install                 # dentro da pasta do projeto, configura o Claude Code sozinho
```

Aí UMA pessoa cria a sala e manda o convite pro time:

```bash
switchboard create projeto-x --name paulo
# imprime algo tipo:  switchboard join eyJyIjoi...  (o convite)
```

Os outros entram colando o convite:

```bash
switchboard join eyJyIjoi...   --name antonio
```

Reinicie o Claude Code na pasta e pronto. Depois é só trabalhar normal e falar com o Claude em linguagem natural ("manda isso pro fulano"). O resto é automático.

## Segurança (tudo automático, nada pra configurar)
- **Criptografia ponta a ponta:** o conteúdo (contexto e mensagens) é cifrado no seu computador antes de subir. O relay (mesmo o público) só guarda blob cifrado e **não consegue ler nada**. A chave nasce do convite, então não tem passo nenhum.
- **Acesso por chave de sala:** o convite carrega sala + chave. Quem não tem o convite não entra (o relay devolve 403). O nome da sala já vem com sufixo aleatório, então nem dá pra adivinhar.
- **Identidade:** cada pessoa ganha um token próprio no `join` (automático, nunca digitado), então ninguém se passa por outro dentro da sala.
- **Relay protegido:** limite de tamanho, salas paradas expiram, e nomes de sala são validados.

Trate o convite como senha (não cole em lugar público). Mesmo assim, como tudo é cifrado, o relay nunca vê o que vocês trabalham.

## O relay (onde a sala vive)

A sala precisa de um lugar pra viver. Duas opções, as duas grátis:

### Dev / teste local (uma máquina, dois terminais)
```bash
switchboard relay         # sobe em http://127.0.0.1:8787
```
Em outro terminal, `join` apontando pra `http://127.0.0.1:8787` e teste com `push`/`pull`.

### Produção cross-machine (grátis): Cloudflare Worker
```bash
cd worker
npm i -g wrangler
wrangler kv namespace create ROOMS     # cole o id no wrangler.toml
wrangler deploy
```
Depois é só `join` apontando pro `--relay https://switchboard.SEU-SUBDOMINIO.workers.dev`.

## Teste rápido (sem Claude, só pra ver funcionando)

```bash
switchboard relay &                                  # terminal 1
switchboard join projeto-x --name paulo
echo "Tarefa: X / Decisao: Y / Estado: Z" | switchboard push --title "Setup"
switchboard pull
switchboard status
```

## Contexto como git (branches, merge e PR)
O contexto anda junto do seu branch do git (detectado sozinho). Então cada branch tem seu próprio contexto, e dá pra:

- **Importar** o contexto de outro branch/colega: você fala "importa o contexto do Antonio" e o Claude pega os dois contextos, junta, e principalmente **aponta as contradições** (ex: "ele decidiu Stripe, você decidiu Mercado Pago, resolve"). Isso o git não faz, ele só junta texto.
- **Pull request de contexto:** "abre um PR do meu contexto pra main". O Claude do revisor lê a proposta + o contexto atual do destino, aponta divergências, junta e aceita (merge). Mesmo fluxo do GitHub, mas pro entendimento do trabalho.
- **Nada é sobrescrito:** se dois mexem no contexto do mesmo branch, o segundo junta em vez de clobberar.

## Ferramentas MCP que o Claude enxerga
- `sb_pull` / `sb_push` - lê/atualiza o contexto do seu branch
- `sb_import` - importa e junta o contexto de outro branch/colega (aponta contradições)
- `sb_propose` / `sb_review` / `sb_accept` - abre, revisa e mergeia um PR de contexto
- `sb_send` - mensagem direcionada a um colega
- `sb_who` - quem está ativo e em qual arquivo
- `sb_note` / `sb_status` - timeline e estado da sala

## Roadmap
- [x] MVP: salas, push/pull de contexto, notas, MCP, CLI, relay local + Worker
- [x] Tudo invisível e seguro: criptografia E2E, identidade, auto-share, guarda de colisão, presença (`sb_who`), concorrência sem sobrescrever, hardening do relay
- [ ] Auto-sync (hook que dá pull no começo de cada turno)
- [ ] Babel mode: tradução automática por idioma de cada participante (o Claude de um fala inglês, o do outro português)
- [ ] N participantes (sala com vários) e histórico/diff de contexto
- [ ] Modo privado: sala num repo/gist do GitHub em vez de relay hosteado

## Aviso e responsabilidade
Projeto experimental e gratuito, feito por uma pessoa não técnica pra galera testar. Sem garantia de nenhum tipo. O autor não se responsabiliza por qualquer dano, perda, custo ou vazamento decorrente do uso. Use por sua conta e risco.

## Feito por
Criado por Paulo, do **Real Oficial** (https://realoficial.com.br) — a forma mais fácil de virar seus conteúdos em cortes virais com IA.

Licença MIT (ver LICENSE).
