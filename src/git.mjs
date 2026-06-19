// Detecta o branch atual do git (o contexto anda junto do branch).
import { execSync } from "node:child_process";

export function currentBranch() {
  try {
    const b = execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return b && b !== "HEAD" ? b : "main";
  } catch {
    return "main"; // fora de um repo git
  }
}
