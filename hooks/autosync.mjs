#!/usr/bin/env node
// Hook de auto-sync (Claude Code: UserPromptSubmit). Roda antes de cada mensagem.
// Checa a sala em silêncio e injeta no contexto do Claude o que é novo:
// contexto novo do time + mensagens direcionadas a você. Nada novo = nada impresso.
import { readConfig } from "../src/config.mjs";
import { getSeen, setSeen } from "../src/state.mjs";
import * as api from "../src/api.mjs";

function fmtTime(t) { try { return new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } }

async function main() {
  const cfg = readConfig();
  if (!cfg.room) return;

  let s;
  try {
    s = await api.pull({ timeout: 2500 });
  } catch (e) {
    if (e.status === 403) { // chave inválida: avisa UMA vez
      const seen = getSeen(cfg.room);
      if (!seen.warned) { setSeen(cfg.room, { warned: true }); process.stdout.write("[switchboard] chave da sala inválida. rode 'switchboard join <convite>' de novo.\n"); }
    }
    return; // rede caída / relay fora: silêncio total
  }

  const seen = getSeen(cfg.room);
  if (seen.warned) setSeen(cfg.room, { warned: false });

  const out = [];
  if (s.context && (s.context.rev || 0) > seen.rev) {
    out.push(`=== CONTEXTO NOVO NA SALA (por ${s.context.by}, ${fmtTime(s.context.at)}) ===`);
    out.push(`# ${s.context.title}`);
    out.push(s.context.body);
  }
  const me = (cfg.name || "").toLowerCase();
  for (const m of (s.messages || []).filter((x) => (x.seq || 0) > seen.lastSeq && (x.to || "").toLowerCase() === me)) {
    out.push(`📨 ${m.by} te mandou (${fmtTime(m.at)}): ${m.text}`);
  }
  // feed do auto-share: notas novas dos colegas (o que cada um está mexendo)
  for (const e of (s.events || []).filter((x) => x.type === "note" && (x.seq || 0) > seen.lastSeq && (x.by || "").toLowerCase() !== me)) {
    out.push(`🔧 ${e.by} ${e.text} (${fmtTime(e.at)})`);
  }

  setSeen(cfg.room, { rev: s.context?.rev || seen.rev, lastSeq: Math.max(seen.lastSeq, s.seq || 0) });

  if (out.length) {
    out.unshift(`[switchboard · sala "${cfg.room}"]`);
    out.push(`(Isto veio do time pela sala. Alinhe seu trabalho com isso antes de responder.)`);
    process.stdout.write(out.join("\n") + "\n");
  }
}

main().catch(() => {});
