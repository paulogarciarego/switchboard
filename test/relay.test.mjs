// Testes de robustez/segurança do switchboard. Roda com: node --test
import { test, before, after } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8911;
const RELAY = `http://127.0.0.1:${PORT}`;
const KEY = "chave-de-teste-123456";
const ROOM = "sala-teste-abc123";

const HOME = mkdtempSync(join(tmpdir(), "sb-test-"));
process.env.HOME = HOME; // a config (chave/sala) vive aqui
mkdirSync(join(HOME, ".switchboard"), { recursive: true });
writeFileSync(join(HOME, ".switchboard", "config.json"),
  JSON.stringify({ relay: RELAY, room: ROOM, name: "antonio", key: KEY, member: "memberA" }));

const H = { "content-type": "application/json", "x-sb-key": KEY, "x-sb-name": "antonio", "x-sb-member": "memberA" };
let relay;

before(async () => {
  relay = spawn(process.execPath, [join(ROOT, "src/relay-server.mjs"), String(PORT)], { env: { ...process.env, HOME }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(RELAY + "/health")).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("relay não subiu");
});
after(() => relay?.kill());

test("E2E: relay guarda cifrado, cliente decifra", async () => {
  const api = await import("../src/api.mjs");
  await api.push({ title: "Secreto", body: "conteudo super secreto 42" });
  const s = await api.pull();
  assert.equal(s.context.body, "conteudo super secreto 42");
  const f = readdirSync(join(HOME, ".switchboard", "rooms"))[0];
  const raw = readFileSync(join(HOME, ".switchboard", "rooms", f), "utf8");
  assert.ok(!raw.includes("super secreto"), "o relay NÃO pode ter o texto claro");
});

test("403: chave errada é barrada", async () => {
  const r = await fetch(`${RELAY}/r/${ROOM}`, { headers: { "x-sb-key": "errada" } });
  assert.equal(r.status, 403);
});

test("403: impersonação (nome de outro com token diferente)", async () => {
  const r = await fetch(`${RELAY}/r/${ROOM}/event`, { method: "POST", headers: { ...H, "x-sb-member": "outroToken" }, body: JSON.stringify({ text: "x" }) });
  assert.equal(r.status, 403);
});

test("409: concorrência não sobrescreve", async () => {
  const api = await import("../src/api.mjs");
  const s = await api.pull();          // rev atual
  await api.push({ title: "a", body: "b" }); // bumpa a rev
  const r = await fetch(`${RELAY}/r/${ROOM}/context`, { method: "PUT", headers: H, body: JSON.stringify({ title: "x", body: "y", baseRev: s.rev }) });
  assert.equal(r.status, 409);          // baseRev velho -> conflito
});

test("mensagem direcionada tem seq e chega", async () => {
  const api = await import("../src/api.mjs");
  await api.send({ to: "helio", text: "oi helio" });
  const s = await api.pull();
  const m = s.messages.find((x) => x.to === "helio" && x.text === "oi helio");
  assert.ok(m && m.seq > 0);
});

test("413: corpo grande demais é barrado", async () => {
  const r = await fetch(`${RELAY}/r/${ROOM}/event`, { method: "POST", headers: H, body: JSON.stringify({ text: "x".repeat(40 * 1024) }) });
  assert.equal(r.status, 413);
});

test("400: nome de sala inválido", async () => {
  const r = await fetch(`${RELAY}/r/${encodeURIComponent("sala invalida!")}`, { headers: { "x-sb-key": KEY } });
  assert.equal(r.status, 400);
});
