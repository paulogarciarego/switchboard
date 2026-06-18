// Relay local (dev). Mantém "salas" em memória + persiste em ~/.switchboard/rooms.
// Em produção isso vira um Cloudflare Worker com a mesma API (ver worker/).
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";

const PORT = Number(process.env.PORT || process.argv[2] || 8787);
const ROOMS_DIR = join(homedir(), ".switchboard", "rooms");
mkdirSync(ROOMS_DIR, { recursive: true });

const file = (room) => join(ROOMS_DIR, encodeURIComponent(room) + ".json");
const empty = () => ({ context: null, events: [], rev: 0 });

function load(room) {
  try { return JSON.parse(readFileSync(file(room), "utf8")); } catch { return empty(); }
}
function save(room, data) { writeFileSync(file(room), JSON.stringify(data, null, 2)); }

function send(res, status, json) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-methods": "GET,PUT,POST,OPTIONS", "access-control-allow-headers": "content-type" });
  res.end(json == null ? "" : JSON.stringify(json));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, null);
  const m = req.url.match(/^\/r\/([^/]+)(\/context|\/event)?\/?$/);
  if (req.url === "/" || req.url === "/health") return send(res, 200, { ok: true, service: "switchboard-relay", rooms: readdirSync(ROOMS_DIR).length });
  if (!m) return send(res, 404, { error: "not found" });

  const room = decodeURIComponent(m[1]);
  const sub = m[2];
  const data = load(room);

  // GET /r/:room  -> estado completo da sala
  if (req.method === "GET" && !sub) return send(res, 200, data);

  // PUT /r/:room/context -> atualiza o documento de contexto
  if (req.method === "PUT" && sub === "/context") {
    const b = await readBody(req);
    data.rev += 1;
    data.context = { title: b.title || "Contexto", body: b.body || "", by: b.by || "?", at: b.at || Date.now(), rev: data.rev };
    data.events.push({ type: "context", by: data.context.by, text: `atualizou o contexto: ${data.context.title}`, at: data.context.at });
    data.events = data.events.slice(-200);
    save(room, data);
    return send(res, 200, { ok: true, rev: data.rev });
  }

  // POST /r/:room/event -> nota rápida na timeline
  if (req.method === "POST" && sub === "/event") {
    const b = await readBody(req);
    data.events.push({ type: "note", by: b.by || "?", text: b.text || "", at: b.at || Date.now() });
    data.events = data.events.slice(-200);
    save(room, data);
    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: "method not allowed" });
});

server.listen(PORT, () => {
  console.log(`switchboard relay rodando em http://127.0.0.1:${PORT}`);
  console.log(`salas em ${ROOMS_DIR}`);
});
