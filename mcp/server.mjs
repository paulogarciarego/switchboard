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
];

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
function ok(id, result) { send({ jsonrpc: "2.0", id, result }); }
function err(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }
function textResult(id, text) { ok(id, { content: [{ type: "text", text }], isError: false }); }
function fmtTime(t) { return new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }

let lastRev = null; // a rev que esta sessão viu por último (pra concorrência)
const active = (s) => Object.entries(s.presence || {}).filter(([, t]) => Date.now() - t < 60 * 6e4).map(([n]) => n);

async function callTool(name, args) {
  const cfg = readConfig();
  if (!cfg.room) return "Você ainda não entrou numa sala. No terminal rode:  switchboard join <convite>";
  switch (name) {
    case "sb_status": {
      const s = await api.pull(); lastRev = s.rev;
      let out = `sala: ${cfg.room} | você: ${cfg.name} | rev: ${s.rev}\nativos agora: ${active(s).join(", ") || "(só você)"}\n`;
      if (s.context) out += `último contexto: "${s.context.title}" por ${s.context.by} (${fmtTime(s.context.at)})\n`;
      out += "eventos recentes:\n" + (s.events.slice(-8).map((e) => `  [${fmtTime(e.at)}] ${e.by}: ${e.text}`).join("\n") || "  (vazio)");
      return out;
    }
    case "sb_pull": {
      const s = await api.pull(); lastRev = s.rev;
      if (!s.context && s.events.length === 0) return "A sala ainda está vazia. Ninguém enviou contexto.";
      let out = "";
      if (s.context) out += `=== CONTEXTO COMPARTILHADO (rev ${s.context.rev}, por ${s.context.by}, ${fmtTime(s.context.at)}) ===\n# ${s.context.title}\n\n${s.context.body}\n\n`;
      out += "=== EVENTOS RECENTES ===\n" + (s.events.slice(-10).map((e) => `[${fmtTime(e.at)}] ${e.by}: ${e.text}`).join("\n") || "(vazio)");
      out += "\n\n(Leia isto, alinhe seu plano com o que o time fez e continue. Se mudou algo importante, chame sb_push.)";
      return out;
    }
    case "sb_push": {
      if (!args?.body) return "Faltou o 'body' (o resumo do contexto).";
      try {
        const r = await api.push({ title: args.title || "Contexto", body: args.body, baseRev: lastRev });
        lastRev = r.rev;
        return `Contexto enviado pra sala "${cfg.room}" (rev ${r.rev}). Os colegas recebem sozinhos.`;
      } catch (e) {
        if (e.status === 409) { // colega mexeu no meio: traz o atual pra você juntar
          const s = await api.pull(); lastRev = s.rev;
          return `CONFLITO: um colega atualizou o contexto enquanto você montava o seu. NÃO foi sobrescrito. Aqui está o contexto atual da sala (rev ${s.rev}):\n\n# ${s.context?.title || ""}\n${s.context?.body || ""}\n\nJunte o que você ia mandar com isso e chame sb_push de novo.`;
        }
        throw e;
      }
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
      const s = await api.pull(); lastRev = s.rev;
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
