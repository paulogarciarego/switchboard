// Guarda o "já vi até aqui" por sala, pra o auto-sync só mostrar o que é novo.
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DIR } from "./config.mjs";

const FILE = join(DIR, "seen.json");

function all() {
  try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return {}; }
}
export function getSeen(room) {
  return all()[room] || { rev: 0, eventAt: 0 };
}
export function setSeen(room, seen) {
  mkdirSync(DIR, { recursive: true });
  const data = all();
  data[room] = seen;
  writeFileSync(FILE, JSON.stringify(data, null, 2));
}
