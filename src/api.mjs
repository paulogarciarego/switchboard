// Cliente do relay. Usado pela CLI e pelo servidor MCP.
import { readConfig } from "./config.mjs";

function base() {
  const { relay, room } = readConfig();
  if (!room) throw new Error("Sem sala. Rode: switchboard join <sala>");
  return { relay: relay.replace(/\/$/, ""), room: encodeURIComponent(room) };
}

async function req(path, opts = {}) {
  const { relay, room } = base();
  const { key } = readConfig();
  const url = `${relay}/r/${room}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { "content-type": "application/json", ...(key ? { "x-sb-key": key } : {}), ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`relay ${res.status}: ${await res.text().catch(() => "")}`);
  return res.status === 204 ? null : res.json();
}

// Pega o estado da sala: contexto atual + eventos recentes
export function pull() {
  return req("");
}

// Sobe/atualiza o documento de contexto compartilhado
export function push({ title, body, by }) {
  return req("/context", {
    method: "PUT",
    body: JSON.stringify({ title, body, by, at: Date.now() }),
  });
}

// Adiciona uma nota rápida (evento) na timeline da sala
export function note({ text, by }) {
  return req("/event", {
    method: "POST",
    body: JSON.stringify({ text, by, at: Date.now() }),
  });
}

// Manda uma mensagem direcionada a um colega (ex: "manda isso pro helio")
export function send({ to, text, by }) {
  return req("/event", {
    method: "POST",
    body: JSON.stringify({ to, text, by, at: Date.now() }),
  });
}
