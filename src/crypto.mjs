// Criptografia ponta a ponta (invisível). A chave nasce do segredo da sala
// (o mesmo que vai no convite). O relay só guarda blob cifrado, não lê nada.
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { readConfig } from "./config.mjs";

const PREFIX = "sbenc1:";

function keyFor() {
  const { key } = readConfig();
  if (!key) return null; // sala sem chave (modo aberto) = sem cifra
  return createHash("sha256").update("switchboard-e2e|" + key).digest(); // 32 bytes
}

// cifra um texto -> string "sbenc1:<base64url(iv|tag|ciphertext)>"
export function enc(plain) {
  const k = keyFor();
  if (k == null || plain == null || plain === "") return plain;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64url");
}

// decifra; se não for nosso formato ou não tiver chave, devolve como veio
export function dec(s) {
  if (typeof s !== "string" || !s.startsWith(PREFIX)) return s;
  const k = keyFor();
  if (k == null) return s;
  try {
    const raw = Buffer.from(s.slice(PREFIX.length), "base64url");
    const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), ct = raw.subarray(28);
    const d = createDecipheriv("aes-256-gcm", k, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    return s; // não consegui decifrar (chave errada): devolve o blob
  }
}
