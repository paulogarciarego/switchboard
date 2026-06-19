#!/usr/bin/env node
// Servidor MCP do switchboard (stdio, JSON-RPC newline-delimited, sem dependências).
// Expõe as ferramentas que o Claude usa: sb_status, sb_pull, sb_push, sb_note.
import { readConfig } from "../src/config.mjs";
import * as api from "../src/api.mjs";

const PROTOCOL = "2024-11-05";
const TOOLS = [
  {
    name: "sb_pull",
    description: "Puxa o contexto compartilhado mais recente da sala (o que os colegas de equipe atualizaram) e os eventos recentes. Use no começo do trabalho ou quando precisar se atualizar.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "sb_push",
    description: "Sobe/atualiza o documento de contexto compartilhado da sala. Mande um resumo curado: tarefa atual, decisões tomadas, estado, arquivos/trechos chave e próximos passos. NÃO mande a conversa inteira.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título curto do contexto, ex: 'Refatorando o checkout'" },
        body: { type: "string", description: "Contexto em markdown: tarefa, decisões, estado, arquivos, próximos passos" },
      },
      required: ["body"],
    },
  },
  {
    name: "sb_send",
    description: "Manda uma mensagem/instrução DIRECIONADA a um colega de equipe pela sala. Use quando o usuário disser algo como 'manda isso pro Hélio' ou 'avisa o Antonio que...'. O Claude do colega recebe automaticamente.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Nome do colega (como ele entrou na sala), ex: 'helio'" },
        text: { type: "string", description: "A instrução/mensagem pra ele" },
      },
      required: ["to", "text"],
    },
  },
  {
    name: "sb_note",
    description: "Manda uma nota rápida na timeline da sala (pra todos), ex: 'mexi no auth.ts, não encoste agora'.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  {
    name: "sb_status",
    description: "Mostra a sala atual, quem você é e o resumo do último contexto + eventos recentes.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "sb_who",
    description: "Mostra quem está ativo na sala agora e quais arquivos cada um está editando. Use quando o usuário perguntar quem está online ou se pode mexer num arquivo.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "sb_import",
    description: "Importa o contexto de outro branch/colega e te devolve os DOIS contextos (o dele e o seu) pra você juntar. Use quando o usuário disser 'importa o contexto do Antonio' ou 'pega o contexto do branch X'. Depois de juntar e apontar contradições, chame sb_push com o resultado.",
    inputSchema: { type: "object", properties: { from: { type: "string", description: "Branch de origem (ex: 'feature/checkout') ou nome do colega" } }, required: ["from"] },
  },
  {
    name: "sb_propose",
    description: "Abre um PR de contexto: propõe o contexto do seu branch pra ser revisado e mergeado num destino (padrão 'main'). Use quando o usuário disser 'abre um PR do contexto' ou 'propõe minhas mudanças pro time revisar'.",
    inputSchema: { type: "object", properties: { to_branch: { type: "string", description: "branch destino (padrão main)" }, title: { type: "string" }, body: { type: "string", description: "o contexto/plano proposto" } }, required: ["title", "body"] },
  },
  {
    name: "sb_review",
    description: "Revisa um PR de contexto aberto: te devolve a proposta + o contexto atual do branch destino, pra você comparar, apontar contradições e decidir. Depois chame sb_accept (com o contexto já juntado) ou sb_close.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "id do PR, ex: pr1" } }, required: ["id"] },
  },
  {
    name: "sb_accept",
    description: "Aceita um PR de contexto, gravando o contexto JÁ JUNTADO por você no branch destino. Use depois de revisar e resolver as contradições.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, body: { type: "string", description: "o contexto final, já mergeado" } }, required: ["id", "title", "body"] },
  },
];

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
function ok(id, result) { send({ jsonrpc: "2.0", id, result }); }
function err(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }
function textResult(id, text) { ok(id, { content: [{ type: "text", text }], isError: false }); }
function fmtTime(t) { return new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }

const lastRev = {}; // rev vista por branch (pra concorrência)
const active = (s) => Object.entries(s.presence || {}).filter(([, t]) => Date.now() - t < 60 * 6e4).map(([n]) => n);
const ctxText = (c) => c ? `# ${c.title}\n\n${c.body}` : "(vazio)";

async function callTool(name, args) {
  const cfg = readConfig();
  if (!cfg.room) return "Você ainda não entrou numa sala. No terminal rode:  switchboard join <convite>";
  const myBranch = api.branch();
  switch (name) {
    case "sb_status": {
      const s = await api.pull(); const c = s.contexts[myBranch]; lastRev[myBranch] = c?.rev || 0;
      const branches = Object.keys(s.contexts || {}).join(", ") || "(nenhum)";
      const open = (s.proposals || []).filter((p) => p.status === "open").map((p) => `${p.id} (${p.fromBranch}->${p.toBranch})`).join(", ");
      let out = `sala: ${cfg.room} | você: ${cfg.name} | branch atual: ${myBranch}\nbranches com contexto: ${branches}\nativos agora: ${active(s).join(", ") || "(só você)"}\nPRs abertos: ${open || "nenhum"}\n`;
      if (c) out += `contexto do "${myBranch}": "${c.title}" por ${c.by} (rev ${c.rev})\n`;
      out += "eventos recentes:\n" + (s.events.slice(-8).map((e) => `  [${fmtTime(e.at)}] ${e.by}: ${e.text}`).join("\n") || "  (vazio)");
      return out;
    }
    case "sb_pull": {
      const s = await api.pull(); const c = s.contexts[myBranch]; lastRev[myBranch] = c?.rev || 0;
      if (!Object.keys(s.contexts || {}).length && s.events.length === 0) return "A sala ainda está vazia. Ninguém enviou contexto.";
      let out = "";
      if (c) out += `=== CONTEXTO DO SEU BRANCH "${myBranch}" (rev ${c.rev}, por ${c.by}) ===\n${ctxText(c)}\n\n`;
      const others = Object.entries(s.contexts || {}).filter(([b]) => b !== myBranch);
      if (others.length) out += "=== OUTROS BRANCHES ===\n" + others.map(([b, x]) => `- ${b}: "${x.title}" (por ${x.by}, rev ${x.rev})`).join("\n") + "\n\n";
      const open = (s.proposals || []).filter((p) => p.status === "open");
      if (open.length) out += "=== PRs DE CONTEXTO ABERTOS ===\n" + open.map((p) => `- ${p.id}: "${p.title}" (${p.fromBranch}->${p.toBranch}, por ${p.by}). Revise com sb_review.`).join("\n") + "\n\n";
      out += "=== TIMELINE ===\n" + (s.events.slice(-10).map((e) => `[${fmtTime(e.at)}] ${e.by}: ${e.text}`).join("\n") || "(vazio)");
      out += "\n\n(Alinhe seu plano com isto. Pra importar um branch use sb_import, pra propor o seu use sb_propose.)";
      return out;
    }
    case "sb_push": {
      if (!args?.body) return "Faltou o 'body' (o resumo do contexto).";
      try {
        const r = await api.push({ title: args.title || "Contexto", body: args.body, baseRev: lastRev[myBranch] ?? 0, branch: myBranch });
        lastRev[myBranch] = r.rev;
        return `Contexto do branch "${myBranch}" atualizado (rev ${r.rev}). O time recebe sozinho.`;
      } catch (e) {
        if (e.status === 409) {
          const s = await api.pull(); const c = s.contexts[myBranch]; lastRev[myBranch] = c?.rev || 0;
          return `CONFLITO: um colega atualizou o contexto do branch "${myBranch}" enquanto você montava o seu. NÃO foi sobrescrito. Contexto atual (rev ${c?.rev}):\n\n${ctxText(c)}\n\nJunte com o que você ia mandar e chame sb_push de novo.`;
        }
        throw e;
      }
    }
    case "sb_import": {
      if (!args?.from) return "Faltou 'from' (o branch/colega de origem).";
      const s = await api.pull(); lastRev[myBranch] = s.contexts[myBranch]?.rev || 0;
      // origem pode ser um branch direto ou o branch onde um colega escreveu por último
      let src = s.contexts[args.from];
      let fromBranch = args.from;
      if (!src) {
        const byPerson = Object.entries(s.contexts || {}).find(([, c]) => (c.by || "").toLowerCase() === args.from.toLowerCase());
        if (byPerson) { fromBranch = byPerson[0]; src = byPerson[1]; }
      }
      if (!src) return `Não achei contexto em "${args.from}". Branches disponíveis: ${Object.keys(s.contexts || {}).join(", ") || "(nenhum)"}.`;
      return `Junte os DOIS contextos abaixo num só. Mantenha o que é compatível e APONTE EXPLICITAMENTE as contradições (ex: decisões opostas) pra resolver com o usuário. Depois chame sb_push com o resultado.\n\n=== O SEU (branch "${myBranch}") ===\n${ctxText(s.contexts[myBranch])}\n\n=== O DE "${fromBranch}" (por ${src.by}) ===\n${ctxText(src)}`;
    }
    case "sb_propose": {
      if (!args?.title || !args?.body) return "Faltou 'title' ou 'body'.";
      const r = await api.propose({ fromBranch: myBranch, toBranch: args.to_branch || "main", title: args.title, body: args.body });
      return `PR de contexto ${r.id} aberto (${myBranch} -> ${args.to_branch || "main"}). O time vê na timeline e revisa com sb_review ${r.id}.`;
    }
    case "sb_review": {
      if (!args?.id) return "Faltou 'id' do PR.";
      const s = await api.pull();
      const p = (s.proposals || []).find((x) => x.id === args.id);
      if (!p) return `PR "${args.id}" não encontrado.`;
      const target = s.contexts[p.toBranch];
      return `Revise este PR de contexto. Compare a PROPOSTA com o contexto ATUAL do destino, aponte contradições, e produza o contexto FINAL juntado. Depois chame sb_accept com {id:"${p.id}", title, body} (ou sb_close se rejeitar).\n\n=== PROPOSTA ${p.id} por ${p.by} (${p.fromBranch}->${p.toBranch}) ===\n# ${p.title}\n${p.body}\n\n=== CONTEXTO ATUAL DE "${p.toBranch}" ===\n${ctxText(target)}`;
    }
    case "sb_accept": {
      if (!args?.id || !args?.title || !args?.body) return "Faltou 'id', 'title' ou 'body' (o contexto final juntado).";
      const r = await api.resolveProposal({ id: args.id, action: "merge", title: args.title, body: args.body });
      return `PR ${args.id} mergeado (${r.status}). O contexto do destino foi atualizado e o time recebe sozinho.`;
    }
    case "sb_send": {
      if (!args?.to || !args?.text) return "Faltou 'to' (pra quem) ou 'text' (a mensagem).";
      await api.send({ to: args.to, text: args.text });
      return `Mensagem enviada pro ${args.to}. O Claude dele recebe automaticamente na próxima mensagem que ele mandar.`;
    }
    case "sb_note": {
      if (!args?.text) return "Faltou o 'text'.";
      await api.note({ text: args.text });
      return "Nota enviada pra timeline da sala.";
    }
    case "sb_who": {
      const s = await api.pull();
      const list = active(s);
      const claims = Object.entries(s.claims || {}).map(([p, c]) => `  ${c.by} em ${p}`).join("\n");
      return `ativos agora na sala "${cfg.room}": ${list.join(", ") || "(só você)"}` + (claims ? `\narquivos em uso:\n${claims}` : "");
    }
    default:
      return `Ferramenta desconhecida: ${name}`;
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) handle(line);
  }
});

async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  try {
    if (method === "initialize") {
      return ok(id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "switchboard", version: "0.1.0" } });
    }
    if (method === "notifications/initialized" || method === "notifications/cancelled") return; // sem resposta
    if (method === "ping") return ok(id, {});
    if (method === "tools/list") return ok(id, { tools: TOOLS });
    if (method === "tools/call") {
      const text = await callTool(params?.name, params?.arguments || {});
      return textResult(id, text);
    }
    if (id !== undefined) err(id, -32601, `método não suportado: ${method}`);
  } catch (e) {
    if (id !== undefined) textResult(id, "Erro: " + e.message);
  }
}
