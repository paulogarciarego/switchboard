// Switchboard relay em Cloudflare Worker (free tier) usando KV.
// Mesma API e modelo do relay local. Conteúdo chega cifrado; o Worker não lê nada.
// Rate limit em produção: configure uma regra no painel do Cloudflare (WAF/Rate Limiting).
// Deploy: ver README. Precisa de um KV binding chamado ROOMS.
const MAX_BODY = 32 * 1024;
const ROOM_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const ROOM_TTL = 14 * 86400;     // segundos (expirationTtl do KV)
const CLAIM_TTL = 10 * 6e4;
const PRESENCE_TTL = 60 * 6e4;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,PUT,POST,OPTIONS",
  "access-control-allow-headers": "content-type,x-sb-key,x-sb-name,x-sb-member",
};
const json = (status, obj) => new Response(obj == null ? "" : JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...cors } });
const empty = () => ({ seq: 0, contexts: {}, proposals: [], events: [], messages: [], claims: {}, presence: {}, keyHash: null, members: {} });
async function sha(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const sanitize = (d) => ({ seq: d.seq, contexts: d.contexts, proposals: d.proposals, events: d.events, messages: d.messages, claims: d.claims, presence: d.presence });
function prune(d) {
  for (const [p, c] of Object.entries(d.claims)) if (Date.now() - c.at > CLAIM_TTL) delete d.claims[p];
  for (const [n, t] of Object.entries(d.presence)) if (Date.now() - t > PRESENCE_TTL) delete d.presence[n];
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return json(204, null);
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/health") return json(200, { ok: true, service: "switchboard-relay" });
    const m = url.pathname.match(/^\/r\/([^/]+)(\/context|\/event|\/claim|\/proposal)?(?:\/([^/]+))?\/?$/);
    if (!m) return json(404, { error: "not found" });

    const room = decodeURIComponent(m[1]), sub = m[2], propId = m[3];
    const branch = url.searchParams.get("branch") || "main";
    if (!ROOM_RE.test(room)) return json(400, { error: "nome de sala inválido" });
    if (Number(req.headers.get("content-length") || 0) > MAX_BODY) return json(413, { error: "conteúdo grande demais" });

    const kvKey = "room:" + room;
    const data = { ...empty(), ...((await env.ROOMS.get(kvKey, "json")) || {}) };

    const provided = req.headers.get("x-sb-key");
    const writing = req.method !== "GET";
    if (data.keyHash) {
      if (!provided || (await sha(provided)) !== data.keyHash) return json(403, { error: "chave da sala incorreta ou ausente" });
    } else if (writing && provided) {
      data.keyHash = await sha(provided);
    }

    const name = req.headers.get("x-sb-name");
    const member = req.headers.get("x-sb-member");
    let by = name || "?";
    if (name && member) {
      const th = await sha(member);
      if (data.members[name] && data.members[name] !== th) return json(403, { error: "esse nome já é de outra pessoa na sala" });
      data.members[name] = th;
    }
    if (name) data.presence[name] = Date.now();
    prune(data);
    const put = () => env.ROOMS.put(kvKey, JSON.stringify(data), { expirationTtl: ROOM_TTL });

    if (req.method === "GET" && !sub) { await put(); return json(200, sanitize(data)); }

    const b = await req.json().catch(() => ({}));
    if (JSON.stringify(b).length > MAX_BODY) return json(413, { error: "conteúdo grande demais" });

    if (req.method === "PUT" && sub === "/context") {
      const cur = data.contexts[branch];
      if (b.baseRev != null && Number(b.baseRev) !== (cur?.rev || 0)) return json(409, { error: "contexto mudou", current: sanitize(data) });
      const rev = (cur?.rev || 0) + 1;
      data.seq += 1;
      data.contexts[branch] = { title: b.title || "", body: b.body || "", by, at: Date.now(), rev };
      data.events.push({ type: "context", by, text: `atualizou o contexto (${branch})`, at: Date.now(), seq: data.seq });
      data.events = data.events.slice(-100);
      await put();
      return json(200, { ok: true, rev });
    }
    if (req.method === "POST" && sub === "/event") {
      data.seq += 1;
      if (b.to) { data.messages.push({ by, to: b.to, text: b.text || "", at: Date.now(), seq: data.seq }); data.messages = data.messages.slice(-500); }
      else { data.events.push({ type: "note", by, text: b.text || "", at: Date.now(), seq: data.seq }); data.events = data.events.slice(-100); }
      await put();
      return json(200, { ok: true, seq: data.seq });
    }
    if (req.method === "POST" && sub === "/claim") {
      if (b.path) {
        if (b.release) { if (data.claims[b.path]?.by === by) delete data.claims[b.path]; }
        else data.claims[b.path] = { by, at: Date.now() };
        await put();
      }
      return json(200, { ok: true });
    }
    if (req.method === "POST" && sub === "/proposal" && !propId) {
      data.seq += 1;
      const id = "pr" + (data.proposals.length + 1);
      const p = { id, by, fromBranch: b.fromBranch || branch, toBranch: b.toBranch || "main", title: b.title || "", body: b.body || "", at: Date.now(), status: "open", seq: data.seq };
      data.proposals.push(p);
      data.events.push({ type: "note", by, text: `abriu PR de contexto ${id}: "${b.titlePlain || id}" (${p.fromBranch} -> ${p.toBranch})`, at: Date.now(), seq: data.seq });
      data.events = data.events.slice(-100);
      await put();
      return json(200, { ok: true, id });
    }
    if (req.method === "POST" && sub === "/proposal" && propId) {
      const p = data.proposals.find((x) => x.id === propId);
      if (!p) return json(404, { error: "PR não encontrado" });
      data.seq += 1;
      if (b.action === "merge") {
        const tb = p.toBranch;
        const rev = (data.contexts[tb]?.rev || 0) + 1;
        data.contexts[tb] = { title: b.title ?? p.title, body: b.body ?? p.body, by, at: Date.now(), rev };
        p.status = "merged";
        data.events.push({ type: "note", by, text: `mergeou o PR ${p.id} em ${tb}`, at: Date.now(), seq: data.seq });
      } else if (b.action === "close") {
        p.status = "closed";
        data.events.push({ type: "note", by, text: `fechou o PR ${p.id}`, at: Date.now(), seq: data.seq });
      }
      data.events = data.events.slice(-100);
      await put();
      return json(200, { ok: true, status: p.status });
    }
    return json(405, { error: "method not allowed" });
  },
};
