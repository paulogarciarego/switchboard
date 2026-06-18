# switchboard

Camada de colaboração pra times que trabalham no mesmo projeto com Claude Code. Em vez de ficar dando ctrl c ctrl v do que o Claude de um disse pro Claude do outro, vocês entram numa **sala** e sincronizam o **contexto importante** por comando. Cada um trabalha na sua máquina, ao mesmo tempo, e os Claudes ficam alinhados.

Não é dois Claudes batendo papo. É um **contexto compartilhado** (tipo um git pra contexto) que cada lado dá `push`/`pull`.

## Como funciona

É automático, em linguagem natural. Você não fica rodando comando.

- Vocês combinam um nome de sala (ex: `projeto-x`) e os dois dão `join` uma vez.
- **Mandar:** você fala pro seu Claude do jeito normal, tipo "manda essas instruções pro Hélio" ou "avisa o Antonio que o contrato mudou". O Claude dispara sozinho (ferramenta `sb_send`).
- **Receber:** o hook de **auto-sync** roda antes de cada mensagem do colega. Quando o Hélio digitar qualquer coisa, o Claude dele já mostra "📨 antonio te mandou: ...". Sem comando.
- Também dá pra compartilhar um documento de contexto curado (tarefa, decisões, arquivos) com `sb_push`, que o auto-sync entrega pros outros.

Limitação honesta: se o colega estiver com o Claude parado sem digitar nada, a mensagem chega no instante em que ele mandar a próxima. Não dá pra injetar numa sessão ociosa.

## Instalação

```bash
npm install -g claude-switchboard
```

## Setup (cada pessoa faz uma vez)

1. Entrar na sala (mesmo nome combinado com o time):

```bash
switchboard join projeto-x --name paulo --relay https://SEU-RELAY
```

2. Ligar o MCP no Claude Code. No `.mcp.json` do projeto (ou global), adicione:

```json
{
  "mcpServers": {
    "switchboard": { "command": "switchboard-mcp" }
  }
}
```

> Enquanto não publica no npm, aponte direto: `"command": "node", "args": ["/caminho/switchboard/mcp/server.mjs"]`.

3. Copie os comandos `claude/commands/sb-pull.md` e `claude/commands/sb-push.md` pra pasta `.claude/commands/` do seu projeto. Aí você usa **/sb-pull** e **/sb-push** dentro do Claude.

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

## Ferramentas MCP que o Claude enxerga
- `sb_pull` - puxa o contexto compartilhado + eventos recentes
- `sb_push` - sobe um resumo curado do contexto
- `sb_note` - manda uma nota rápida na timeline
- `sb_status` - estado da sala

## Roadmap
- [x] MVP: salas, push/pull de contexto, notas, MCP, CLI, relay local + Worker
- [ ] Auto-sync (hook que dá pull no começo de cada turno)
- [ ] Babel mode: tradução automática por idioma de cada participante (o Claude de um fala inglês, o do outro português)
- [ ] N participantes (sala com vários) e histórico/diff de contexto
- [ ] Modo privado: sala num repo/gist do GitHub em vez de relay hosteado

MIT.
