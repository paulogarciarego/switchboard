// Lê/escreve a config local em ~/.switchboard/config.json
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

export const DIR = join(homedir(), ".switchboard");
const FILE = join(DIR, "config.json");

const DEFAULTS = { relay: "http://127.0.0.1:8787", room: null, name: null, key: null, member: null };

export function readConfig() {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, "utf8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeConfig(patch) {
  mkdirSync(DIR, { recursive: true });
  const cfg = { ...readConfig(), ...patch };
  writeFileSync(FILE, JSON.stringify(cfg, null, 2));
  return cfg;
}

export function requireRoom() {
  const cfg = readConfig();
  if (!cfg.room) {
    throw new Error("Você ainda não entrou numa sala. Rode:  switchboard join <sala>");
  }
  return cfg;
}
