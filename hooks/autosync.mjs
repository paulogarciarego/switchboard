#!/usr/bin/env node
// Hook de auto-sync (Claude Code: UserPromptSubmit).
// Roda antes de cada mensagem sua. Checa a sala em silêncio e, se chegou
// contexto novo ou mensagem direcionada a você, injeta no contexto do Claude.
// Se nada mudou (ou relay fora), não imprime nada e não atrapalha.
import { readConfig } from "../src/config.mjs";
import { getSeen, setSeen } from "../src/state.mjs";

function fmtTime(t) { try { return new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } }

async function main() {
  const cfg = readConfig();
  if (!cfg.room) return; // não entrou em sala nenhuma

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500); // nunca travar o prompt
  let data;
  try {
    const url = `${cfg.relay.replace(/\/$/, "")}/r/${encodeURIComponent(cfg.room)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return;
    data = await res.json();
  } catch { return; } finally { clearTimeout(timer); }

  const seen = getSeen(cfg.room);
  const out = [];

  // contexto novo?
  if (data.context && data.context.rev > seen.rev) {
    out.push(`=== CONTEXTO NOVO NA SALA (por ${data.context.by}, ${fmtTime(data.context.at)}) ===`);
    out.push(`# ${data.context.title}`);
    out.push(data.context.body);
  }

  // mensagens direcionadas a mim que ainda não vi
  const me = (cfg.name || "").toLowerCase();
  const msgs = (data.events || []).filter(
    (e) => e.type === "message" && e.at > seen.eventAt && (e.to || "").toLowerCase() === me
  );
  for (const m of msgs) out.push(`📨 ${m.by} te mandou (${fmtTime(m.at)}): ${m.text}`);

  // atualiza o "já vi"
  const lastEventAt = (data.events || []).reduce((mx, e) => Math.max(mx, e.at || 0), seen.eventAt);
  setSeen(cfg.room, { rev: data.context?.rev || seen.rev, eventAt: lastEventAt });

  if (out.length) {
    out.unshift(`[switchboard · sala "${cfg.room}"]`);
    out.push(`(Isto veio do time pela sala. Alinhe seu trabalho com isso antes de responder.)`);
    process.stdout.write(out.join("\n") + "\n");
  }
}

main().catch(() => {});
