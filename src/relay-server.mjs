// Relay local (dev). Mesma API do Cloudflare Worker (worker/worker.js).
// Guarda salas em ~/.switchboard/rooms. O conteúdo já chega cifrado do cliente;
// o relay nunca vê texto claro. Faz só roteamento, identidade e limites.
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";

const PORT = Number(process.env.PORT || process.argv[2] || 8787);
const ROOMS_DIR = join(homedir(), ".switchboard", "rooms");
mkdirSync(ROOMS_DIR, { recursive: true });

const MAX_BODY = 32 * 1024;          // 32KB por request
const ROOM_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const ROOM_TTL = 14 * 864e5;         // 14 dias sem uso -> sala expira
const CLAIM_TTL = 10 * 6e4;          // claim de arquivo expira em 10 min
const PRESENCE_TTL = 60 * 6e4;       // presença "ativa" por 60 min
const RL_WINDOW = 1e4, RL_MAX = 120; // 120 req / 10s por sala

const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
const file = (room) => join(ROOMS_DIR, encodeURIComponent(room) + ".json");
const empty = () => ({ seq: 0, contexts: {}, proposals: [], events: [], messages: [], claims: {}, presence: {}, keyHash: null, members: {}, updatedAt: Date.now() });

function load(room) {
  try {
    const f = file(room);
    if (Date.now() - statSync(f).mtimeMs > ROOM_TTL) { rmSync(f, { force: true }); return empty(); }
    return { ...empty(), ...JSON.parse(readFileSync(f, "utf8")) };
  } catch { return empty(); }
}
function save(room, data) {
  data.updatedAt = Date.now();
  for (const [p, c] of Object.entries(data.claims)) if (Date.now() - c.at > CLAIM_TTL) delete data.claims[p];
  for (const [n, t] of Object.entries(data.presence)) if (Date.now() - t > PRESENCE_TTL) delete data.presence[n];
  writeFileSync(file(room), JSON.stringify(data));
}
const sanitize = (d) => ({ seq: d.seq, contexts: d.contexts, proposals: d.proposals, events: d.events, messages: d.messages, claims: d.claims, presence: d.presence });

const rl = new Map();
function rateLimited(room) {
  const now = Date.now(); const e = rl.get(room);
  if (!e || now - e.start > RL_WINDOW) { rl.set(room, { start: now, n: 1 }); return false; }
  e.n++; return e.n > RL_MAX;
}

function send(res, status, json) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-methods": "GET,PUT,POST,OPTIONS", "access-control-allow-headers": "content-type,x-sb-key,x-sb-name,x-sb-member" });
  res.end(json == null ? "" : JSON.stringify(json));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = "", over = false;
    req.on("data", (c) => { if (over) return; b += c; if (b.length > MAX_BODY) over = true; });
    req.on("end", () => { if (over) return resolve({ __over: true }); try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, null);
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/" || u.pathname === "/health") return send(res, 200, { ok: true, service: "switchboard-relay" });
  const m = u.pathname.match(/^\/r\/([^/]+)(\/context|\/event|\/claim|\/proposal)?(?:\/([^/]+))?\/?$/);
  if (!m) return send(res, 404, { error: "not found" });

  const room = decodeURIComponent(m[1]);
  if (!ROOM_RE.test(room)) return send(res, 400, { error: "nome de sala inválido" });
  if (rateLimited(room)) return send(res, 429, { error: "muitas requisições, espere um pouco" });

  const sub = m[2];
  const propId = m[3];
  const branch = u.searchParams.get("branch") || "main";
  const data = load(room);

  // chave de acesso
  const provided = req.headers["x-sb-key"];
  const writing = req.method !== "GET";
  if (data.keyHash) {
    if (!provided || sha(provided) !== data.keyHash) return send(res, 403, { error: "chave da sala incorreta ou ausente" });
  } else if (writing && provided) {
    data.keyHash = sha(provided);
  }

  // identidade (o "by" sai daqui, não do corpo)
  const name = req.headers["x-sb-name"];
  const member = req.headers["x-sb-member"];
  let by = name || "?";
  if (name && member) {
    const th = sha(member);
    if (data.members[name] && data.members[name] !== th) return send(res, 403, { error: "esse nome já é de outra pessoa na sala" });
    data.members[name] = th;
  }
  if (name) data.presence[name] = Date.now();

  // GET -> estado da sala
  if (req.method === "GET" && !sub) { save(room, data); return send(res, 200, sanitize(data)); }

  const b = await readBody(req);
  if (b.__over) return send(res, 413, { error: "conteúdo grande demais" });

  // PUT /context?branch=B -> contexto do branch, com concorrência otimista por branch
  if (req.method === "PUT" && sub === "/context") {
    const cur = data.contexts[branch];
    if (b.baseRev != null && Number(b.baseRev) !== (cur?.rev || 0)) {
      return send(res, 409, { error: "contexto mudou", current: sanitize(data) });
    }
    const rev = (cur?.rev || 0) + 1;
    data.seq += 1;
    data.contexts[branch] = { title: b.title || "", body: b.body || "", by, at: Date.now(), rev };
    data.events.push({ type: "context", by, text: `atualizou o contexto (${branch})`, at: Date.now(), seq: data.seq });
    data.events = data.events.slice(-100);
    save(room, data);
    return send(res, 200, { ok: true, rev });
  }

  // POST /event -> nota (timeline) ou mensagem direcionada (to)
  if (req.method === "POST" && sub === "/event") {
    data.seq += 1;
    if (b.to) {
      data.messages.push({ by, to: b.to, text: b.text || "", at: Date.now(), seq: data.seq });
      data.messages = data.messages.slice(-500);
    } else {
      data.events.push({ type: "note", by, text: b.text || "", at: Date.now(), seq: data.seq });
      data.events = data.events.slice(-100);
    }
    save(room, data);
    return send(res, 200, { ok: true, seq: data.seq });
  }

  // POST /claim -> marca/solta que estou num arquivo
  if (req.method === "POST" && sub === "/claim") {
    if (b.path) {
      if (b.release) { if (data.claims[b.path]?.by === by) delete data.claims[b.path]; }
      else data.claims[b.path] = { by, at: Date.now() };
      save(room, data);
    }
    return send(res, 200, { ok: true });
  }

  // POST /proposal -> abre um PR de contexto (fromBranch -> toBranch)
  if (req.method === "POST" && sub === "/proposal" && !propId) {
    data.seq += 1;
    const id = "pr" + (data.proposals.length + 1);
    const p = { id, by, fromBranch: b.fromBranch || branch, toBranch: b.toBranch || "main", title: b.title || "", body: b.body || "", at: Date.now(), status: "open", seq: data.seq };
    data.proposals.push(p);
    data.events.push({ type: "note", by, text: `abriu PR de contexto ${id}: "${b.titlePlain || id}" (${p.fromBranch} -> ${p.toBranch})`, at: Date.now(), seq: data.seq });
    data.events = data.events.slice(-100);
    save(room, data);
    return send(res, 200, { ok: true, id });
  }

  // POST /proposal/:id -> aceitar (merge) ou fechar um PR de contexto
  if (req.method === "POST" && sub === "/proposal" && propId) {
    const p = data.proposals.find((x) => x.id === propId);
    if (!p) return send(res, 404, { error: "PR não encontrado" });
    data.seq += 1;
    if (b.action === "merge") {
      const tb = p.toBranch;
      const rev = (data.contexts[tb]?.rev || 0) + 1;
      // o body do merge vem do revisor (já juntado pelo Claude dele)
      data.contexts[tb] = { title: b.title ?? p.title, body: b.body ?? p.body, by, at: Date.now(), rev };
      p.status = "merged";
      data.events.push({ type: "note", by, text: `mergeou o PR ${p.id} em ${tb}`, at: Date.now(), seq: data.seq });
    } else if (b.action === "close") {
      p.status = "closed";
      data.events.push({ type: "note", by, text: `fechou o PR ${p.id}`, at: Date.now(), seq: data.seq });
    }
    data.events = data.events.slice(-100);
    save(room, data);
    return send(res, 200, { ok: true, status: p.status });
  }

  return send(res, 405, { error: "method not allowed" });
});

server.listen(PORT, () => {
  console.log(`switchboard relay rodando em http://127.0.0.1:${PORT}`);
  console.log(`salas em ${ROOMS_DIR}`);
});
