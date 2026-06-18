// Switchboard relay em Cloudflare Worker (free tier) usando KV.
// Mesma API do relay local. Deploy: ver README. Precisa de um KV binding chamado ROOMS.
//   wrangler kv namespace create ROOMS  (e cole o id no wrangler.toml)
//   wrangler deploy
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,PUT,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};
const json = (status, obj) => new Response(obj == null ? "" : JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...cors } });
const empty = () => ({ context: null, events: [], rev: 0 });
async function sha(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const sanitize = (d) => ({ context: d.context, events: d.events, rev: d.rev });

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return json(204, null);
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/health") return json(200, { ok: true, service: "switchboard-relay" });
    const m = url.pathname.match(/^\/r\/([^/]+)(\/context|\/event)?\/?$/);
    if (!m) return json(404, { error: "not found" });
    const room = decodeURIComponent(m[1]), sub = m[2];
    const kvKey = "room:" + room;
    const data = (await env.ROOMS.get(kvKey, "json")) || empty();

    // controle de acesso por chave de sala
    const provided = req.headers.get("x-sb-key");
    const providedHash = provided ? await sha(provided) : null;
    const writing = req.method !== "GET";
    if (data.keyHash) {
      if (providedHash !== data.keyHash) return json(403, { error: "chave da sala incorreta ou ausente" });
    } else if (writing && provided) {
      data.keyHash = providedHash;
    }

    if (req.method === "GET" && !sub) return json(200, sanitize(data));

    if (req.method === "PUT" && sub === "/context") {
      const b = await req.json().catch(() => ({}));
      data.rev += 1;
      data.context = { title: b.title || "Contexto", body: b.body || "", by: b.by || "?", at: b.at || Date.now(), rev: data.rev };
      data.events.push({ type: "context", by: data.context.by, text: `atualizou o contexto: ${data.context.title}`, at: data.context.at });
      data.events = data.events.slice(-200);
      await env.ROOMS.put(kvKey, JSON.stringify(data));
      return json(200, { ok: true, rev: data.rev });
    }
    if (req.method === "POST" && sub === "/event") {
      const b = await req.json().catch(() => ({}));
      data.events.push({ type: b.to ? "message" : "note", by: b.by || "?", to: b.to || null, text: b.text || "", at: b.at || Date.now() });
      data.events = data.events.slice(-200);
      await env.ROOMS.put(kvKey, JSON.stringify(data));
      return json(200, { ok: true });
    }
    return json(405, { error: "method not allowed" });
  },
};
