// Guarda o "já vi até aqui" por sala, pro auto-sync só mostrar o que é novo.
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DIR } from "./config.mjs";

const FILE = join(DIR, "seen.json");

function all() {
  try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return {}; }
}
export function getSeen(room) {
  return { lastSeq: 0, warned: false, ctxRev: {}, ...(all()[room] || {}) };
}
export function setSeen(room, patch) {
  mkdirSync(DIR, { recursive: true });
  const data = all();
  data[room] = { ...getSeen(room), ...patch };
  writeFileSync(FILE, JSON.stringify(data, null, 2));
}
