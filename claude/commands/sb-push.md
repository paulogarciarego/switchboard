---
description: Sobe um resumo curado do contexto atual pra sala, pro time se atualizar
---

Monte um resumo CURADO do estado atual do trabalho e envie com a ferramenta `sb_push` do switchboard.

O resumo (campo `body`, em markdown) deve ter, curto e direto:
- **Tarefa atual:** o que está sendo feito agora.
- **Decisões:** escolhas importantes já tomadas (e o porquê, em uma linha).
- **Estado:** o que já está pronto e o que falta.
- **Arquivos chave:** caminhos dos arquivos mexidos ou importantes (com 1 linha do que mudou).
- **Próximos passos:** o que vem agora.
- **Avisos:** algo que o colega precisa saber pra não conflitar (ex: "estou no checkout.ts, não encoste").

Regras:
- NÃO mande a conversa inteira nem código longo. É um briefing, não um dump.
- Use um `title` curto e específico (ex: "Checkout: troca pro Stripe").
- Depois de enviar, confirme pro usuário o que foi compartilhado.
