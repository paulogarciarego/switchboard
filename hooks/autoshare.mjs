#!/usr/bin/env node
// Hook de auto-share (Claude Code: Stop). Roda quando o Claude termina o turno.
// Se você mexeu em arquivos, publica sozinho um resumo curto na sala ("fulano
// mexeu em a.ts, b.ts"), deduplicado e com throttle. Ninguém precisa "mandar".
import { execSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { readConfig, DIR } from "../src/config.mjs";
import * as api from "../src/api.mjs";

const STATE = join(DIR, "autoshare.json");
const THROTTLE = 20_000; // no máximo 1 share a cada 20s

function git(args) { try { return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } }
function lastShare() { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return { files: "", at: 0 }; } }
function saveShare(s) { mkdirSync(DIR, { recursive: true }); writeFileSync(STATE, JSON.stringify(s)); }

async function main() {
  const cfg = readConfig();
  if (!cfg.room) return;

  // arquivos mexidos no repo (não rastreados + modificados)
  const changed = git("status --porcelain")
    .split("\n").map((l) => l.trim().replace(/^\S+\s+/, "")).filter(Boolean)
    .filter((f) => !f.startsWith(".switchboard") && f !== ".mcp.json")
    .sort();
  if (!changed.length) return;

  const key = changed.join("|");
  const prev = lastShare();
  if (key === prev.files && Date.now() - prev.at < THROTTLE) return; // nada novo / cedo demais

  const list = changed.slice(0, 6).join(", ") + (changed.length > 6 ? ` (+${changed.length - 6})` : "");
  try { await api.note({ text: `mexeu em ${list}` }); saveShare({ files: key, at: Date.now() }); } catch {}
}

main().catch(() => {});
