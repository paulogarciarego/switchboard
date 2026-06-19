#!/usr/bin/env node
// Hook de guarda de colisão (Claude Code: PreToolUse em Edit/Write/MultiEdit).
// Antes de editar um arquivo: se um colega ativo está mexendo nele agora, avisa
// e pede confirmação. E marca (claim) que VOCÊ está nesse arquivo. Invisível:
// você edita normal, só aparece algo se fosse colidir.
import { execSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, relative, basename } from "node:path";
import { readConfig } from "../src/config.mjs";
import * as api from "../src/api.mjs";

const PRESENCE_ACTIVE = 60 * 6e4; // colega "ativo" = visto nos últimos 60 min

function readStdin() {
  return new Promise((resolve) => {
    let d = ""; if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (d += c)); process.stdin.on("end", () => resolve(d));
  });
}
function repoRel(fp) {
  try { fp = realpathSync(fp); } catch {}
  try {
    const top = realpathSync(execSync(`git -C "${dirname(fp)}" rev-parse --show-toplevel`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim());
    const r = relative(top, fp);
    if (r && !r.startsWith("..")) return r;
  } catch {}
  return basename(fp);
}

async function main() {
  const raw = await readStdin();
  let input = {}; try { input = JSON.parse(raw); } catch {}
  const tool = input.tool_name || input.toolName || "";
  const fp = input.tool_input?.file_path || input.toolInput?.file_path;
  if (!/^(Edit|Write|MultiEdit)$/.test(tool) || !fp) return; // não é edição: deixa passar

  const cfg = readConfig();
  if (!cfg.room) return;
  const path = repoRel(fp);
  const me = (cfg.name || "").toLowerCase();

  let s;
  try { s = await api.pull({ timeout: 2000 }); } catch { /* relay fora: não atrapalha */ }

  // marca que estou nesse arquivo (não bloqueia se falhar)
  api.claim({ path }).catch(() => {});

  if (s) {
    const c = s.claims?.[path];
    const active = c && (c.by || "").toLowerCase() !== me && Date.now() - c.at < PRESENCE_ACTIVE && (s.presence?.[c.by] && Date.now() - s.presence[c.by] < PRESENCE_ACTIVE);
    if (active) {
      const out = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: `⚠ switchboard: ${c.by} está editando "${path}" agora. Confirme se quer mesmo mexer pra não dar conflito.`,
        },
      };
      process.stdout.write(JSON.stringify(out));
    }
  }
}

main().catch(() => {});
