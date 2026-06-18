#!/usr/bin/env node
// CLI do switchboard: join / push / pull / note / status / relay
import { readFileSync } from "node:fs";
import { readConfig, writeConfig } from "../src/config.mjs";
import * as api from "../src/api.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n, d) => { const i = rest.indexOf("--" + n); return i >= 0 ? rest[i + 1] : d; };
const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1]?.startsWith("--")));

function fmtTime(t) { return new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }

async function main() {
  switch (cmd) {
    case "join": {
      const room = positional[0];
      if (!room) return fail("uso: switchboard join <sala> [--name SEU_NOME] [--relay URL]");
      const cfg = writeConfig({
        room,
        name: flag("name", readConfig().name || process.env.USER || "anon"),
        relay: flag("relay", readConfig().relay),
      });
      console.log(`entrou na sala "${cfg.room}" como ${cfg.name}`);
      console.log(`relay: ${cfg.relay}`);
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
      const r = await api.push({ title, body, by: cfg.name });
      console.log(`contexto enviado (rev ${r.rev})`);
      break;
    }
    case "note": {
      const cfg = readConfig();
      const text = positional.join(" ");
      if (!text) return fail("uso: switchboard note \"mexi no arquivo X\"");
      await api.note({ text, by: cfg.name });
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

      // 2) hook de auto-sync em .claude/settings.json
      mkdirSync(".claude", { recursive: true });
      const setPath = ".claude/settings.json";
      const set = readJson(setPath);
      set.hooks = set.hooks || {};
      set.hooks.UserPromptSubmit = set.hooks.UserPromptSubmit || [];
      const already = JSON.stringify(set.hooks.UserPromptSubmit).includes("switchboard-autosync");
      if (!already) set.hooks.UserPromptSubmit.push({ hooks: [{ type: "command", command: "switchboard-autosync" }] });
      writeFileSync(setPath, JSON.stringify(set, null, 2));

      console.log("switchboard ligado neste projeto:");
      console.log("  .mcp.json            -> ferramentas (sb_send, sb_push, sb_pull...)");
      console.log("  .claude/settings.json-> hook de auto-sync (recebe sozinho)");
      console.log(already ? "  (hook já estava ligado)" : "");
      console.log("\nagora rode:  switchboard join <sala> --name SEU_NOME");
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
  switchboard join <sala> [--name NOME] [--relay URL]   entra numa sala
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
