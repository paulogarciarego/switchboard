#!/usr/bin/env node
// CLI do switchboard: join / push / pull / note / status / relay
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { readConfig, writeConfig } from "../src/config.mjs";
import * as api from "../src/api.mjs";

const rand = (n) => randomBytes(n).toString("hex");
const slug = (s) => (s || "sala").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sala";
const makeInvite = ({ r, k, u }) => Buffer.from(JSON.stringify({ r, k, u })).toString("base64url");
function parseInvite(s) {
  try { const o = JSON.parse(Buffer.from(s, "base64url").toString("utf8")); if (o && o.r && o.k) return o; } catch {}
  return null;
}

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n, d) => { const i = rest.indexOf("--" + n); return i >= 0 ? rest[i + 1] : d; };
const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1]?.startsWith("--")));

function fmtTime(t) { return new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }

async function main() {
  switch (cmd) {
    case "create": {
      // cria uma sala nova, com nome único e chave secreta
      const name = flag("name", readConfig().name || process.env.USER || "anon");
      const relay = flag("relay", readConfig().relay);
      const room = slug(positional[0]) + "-" + rand(3); // nome amigável + sufixo aleatório
      const key = rand(12); // chave secreta da sala
      writeConfig({ room, key, relay, name, member: readConfig().member || rand(16) });
      const invite = makeInvite({ r: room, k: key, u: relay });
      console.log(`sala criada: ${room}`);
      console.log(`você entrou como: ${name}\n`);
      console.log("MANDE este convite pro seu time (quem tiver ele entra, quem não tiver não):\n");
      console.log(`  switchboard join ${invite}\n`);
      console.log("(o convite já carrega a sala + a chave + o relay)");
      break;
    }
    case "join": {
      const arg = positional[0];
      if (!arg) return fail("uso: switchboard join <convite>   (ou: join <sala> --key CHAVE)");
      const inv = parseInvite(arg);
      const member = readConfig().member || rand(16);
      const cfg = inv
        ? writeConfig({ room: inv.r, key: inv.k, relay: inv.u || readConfig().relay, name: flag("name", readConfig().name || process.env.USER || "anon"), member })
        : writeConfig({ room: arg, key: flag("key", null), relay: flag("relay", readConfig().relay), name: flag("name", readConfig().name || process.env.USER || "anon"), member });
      console.log(`entrou na sala "${cfg.room}" como ${cfg.name}`);
      console.log(cfg.key ? "sala protegida por chave ✓" : "sala aberta (sem chave) ⚠");
      break;
    }
    case "status": {
      const cfg = readConfig();
      console.log(`sala:  ${cfg.room || "(nenhuma, rode: switchboard join <sala>)"}`);
      console.log(`nome:  ${cfg.name || "-"}`);
      console.log(`relay: ${cfg.relay}`);
      if (cfg.room) {
        const s = await api.pull();
        console.log(`rev:   ${s.rev}`);
        if (s.context) console.log(`ultimo contexto: "${s.context.title}" por ${s.context.by} (${fmtTime(s.context.at)})`);
        console.log("eventos recentes:");
        for (const e of s.events.slice(-6)) console.log(`  [${fmtTime(e.at)}] ${e.by}: ${e.text}`);
      }
      break;
    }
    case "pull": {
      const s = await api.pull();
      if (!s.context) { console.log("(sala sem contexto ainda)"); break; }
      console.log(`# ${s.context.title}\n(por ${s.context.by}, ${fmtTime(s.context.at)}, rev ${s.context.rev})\n`);
      console.log(s.context.body);
      break;
    }
    case "push": {
      const cfg = readConfig();
      const title = flag("title", "Contexto");
      const fileArg = flag("file");
      let body = fileArg ? readFileSync(fileArg, "utf8") : await readStdin();
      if (!body?.trim()) return fail("nada pra enviar. uso: echo '...' | switchboard push --title 'X'   ou  --file contexto.md");
      const r = await api.push({ title, body });
      console.log(`contexto enviado (rev ${r.rev})`);
      break;
    }
    case "note": {
      const text = positional.join(" ");
      if (!text) return fail("uso: switchboard note \"mexi no arquivo X\"");
      await api.note({ text });
      console.log("nota enviada");
      break;
    }
    case "install": {
      // Configura o Claude Code sozinho: liga o MCP (.mcp.json) e o hook de
      // auto-sync (.claude/settings.json) na pasta atual (o projeto).
      const { readFileSync, writeFileSync, mkdirSync, existsSync } = await import("node:fs");
      const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; } };

      // 1) MCP em .mcp.json
      const mcpPath = ".mcp.json";
      const mcp = readJson(mcpPath);
      mcp.mcpServers = mcp.mcpServers || {};
      mcp.mcpServers.switchboard = { command: "switchboard-mcp" };
      writeFileSync(mcpPath, JSON.stringify(mcp, null, 2));

      // 2) hooks invisíveis em .claude/settings.json (idempotente)
      mkdirSync(".claude", { recursive: true });
      const setPath = ".claude/settings.json";
      const set = readJson(setPath);
      set.hooks = set.hooks || {};
      const addHook = (event, command, matcher) => {
        set.hooks[event] = set.hooks[event] || [];
        if (JSON.stringify(set.hooks[event]).includes(command)) return;
        const entry = { hooks: [{ type: "command", command }] };
        if (matcher) entry.matcher = matcher;
        set.hooks[event].push(entry);
      };
      addHook("UserPromptSubmit", "switchboard-autosync");                 // recebe sozinho
      addHook("Stop", "switchboard-autoshare");                            // compartilha sozinho
      addHook("PreToolUse", "switchboard-guard", "Edit|Write|MultiEdit");  // guarda de colisão
      writeFileSync(setPath, JSON.stringify(set, null, 2));

      console.log("switchboard ligado neste projeto:");
      console.log("  .mcp.json             -> ferramentas (sb_send, sb_push, sb_pull, sb_who...)");
      console.log("  .claude/settings.json -> hooks invisíveis:");
      console.log("     auto-sync (recebe), auto-share (compartilha), guarda (anti-colisão)");
      console.log("\nagora rode:  switchboard join <convite>");
      console.log("e reinicie o Claude Code nessa pasta.");
      break;
    }
    case "relay": {
      await import("../src/relay-server.mjs");
      break;
    }
    default:
      console.log(`switchboard - colaboração de contexto entre instâncias de Claude

uso:
  switchboard install                                   liga o switchboard no Claude Code (deste projeto)
  switchboard create [nome] [--name SEU_NOME]           cria uma sala com chave e gera um convite
  switchboard join <convite>                            entra numa sala pelo convite (ou: join <sala> --key CHAVE)
  switchboard pull                                      mostra o contexto atual da sala
  switchboard push --title "X" [--file f.md]            envia contexto (ou via stdin)
  switchboard note "..."                                manda uma nota rápida na timeline
  switchboard status                                    estado da sala
  switchboard relay [porta]                             sobe um relay local (dev)

dica: o uso normal é dentro do Claude Code com os comandos /sb-pull e /sb-push (MCP).`);
  }
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let d = ""; process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (d += c)); process.stdin.on("end", () => resolve(d));
  });
}
function fail(msg) { console.error(msg); process.exitCode = 1; }

main().catch((e) => fail(e.message));
