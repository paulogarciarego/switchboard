// Cliente do relay. Usado pela CLI, pelo MCP e pelos hooks.
// Cifra o conteúdo na saída e decifra na entrada (o relay nunca vê texto claro).
import { readConfig } from "./config.mjs";
import { enc, dec } from "./crypto.mjs";
import { currentBranch } from "./git.mjs";

function base() {
  const { relay, room } = readConfig();
  if (!room) throw new Error("Sem sala. Rode: switchboard join <convite>");
  return { relay: relay.replace(/\/$/, ""), room: encodeURIComponent(room) };
}

async function req(path, opts = {}) {
  const { relay, room } = base();
  const cfg = readConfig();
  const headers = {
    "content-type": "application/json",
    ...(cfg.key ? { "x-sb-key": cfg.key } : {}),
    ...(cfg.name ? { "x-sb-name": cfg.name } : {}),
    ...(cfg.member ? { "x-sb-member": cfg.member } : {}),
    ...(opts.headers || {}),
  };
  let signal, timer;
  if (opts.timeout) { const ac = new AbortController(); timer = setTimeout(() => ac.abort(), opts.timeout); signal = ac.signal; }
  let res;
  try {
    res = await fetch(`${relay}/r/${room}${path}`, { method: opts.method, body: opts.body, headers, signal });
  } finally { if (timer) clearTimeout(timer); }
  if (res.status === 409) { const e = new Error("conflito"); e.status = 409; e.payload = await res.json().catch(() => ({})); throw e; }
  if (!res.ok) { const e = new Error(`relay ${res.status}: ${await res.text().catch(() => "")}`); e.status = res.status; throw e; }
  return res.status === 204 ? null : res.json();
}

// decifra os campos de conteúdo de um estado de sala
function decryptState(s) {
  if (!s) return s;
  for (const c of Object.values(s.contexts || {})) { c.title = dec(c.title); c.body = dec(c.body); }
  for (const p of s.proposals || []) { p.title = dec(p.title); p.body = dec(p.body); }
  for (const e of s.events || []) if (e.text) e.text = dec(e.text);
  for (const m of s.messages || []) if (m.text) m.text = dec(m.text);
  return s;
}

// estado da sala (contextos por branch + PRs + timeline + mensagens), já decifrado
export async function pull(opts = {}) {
  return decryptState(await req("", { timeout: opts.timeout }));
}

export function branch() { return currentBranch(); }

// sobe/atualiza o contexto do SEU branch (cifrado). baseRev = a rev que vc viu.
export function push({ title, body, baseRev, branch: br }) {
  const b = br || currentBranch();
  return req(`/context?branch=${encodeURIComponent(b)}`, { method: "PUT", body: JSON.stringify({ title: enc(title), body: enc(body), baseRev }) });
}

// abre um PR de contexto (do seu branch pra um destino, padrão main)
export function propose({ fromBranch, toBranch, title, body }) {
  return req("/proposal", { method: "POST", body: JSON.stringify({ fromBranch: fromBranch || currentBranch(), toBranch: toBranch || "main", title: enc(title), body: enc(body), titlePlain: (title || "").slice(0, 60) }) });
}

// aceita (merge) ou fecha um PR. No merge, manda o contexto já juntado pelo revisor.
export function resolveProposal({ id, action, title, body }) {
  return req(`/proposal/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ action, title: title != null ? enc(title) : undefined, body: body != null ? enc(body) : undefined }) });
}

// nota rápida na timeline (pra todos), cifrada
export function note({ text }) {
  return req("/event", { method: "POST", body: JSON.stringify({ text: enc(text) }) });
}

// mensagem direcionada a um colega, cifrada
export function send({ to, text }) {
  return req("/event", { method: "POST", body: JSON.stringify({ to, text: enc(text) }) });
}

// marca/solta que estou (ou parei) num arquivo
export function claim({ path, release }) {
  return req("/claim", { method: "POST", body: JSON.stringify({ path, release: !!release }) });
}
