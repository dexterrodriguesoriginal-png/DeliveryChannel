# Paleta e Legenda das Mesas (Salão do Dono e App do Garçom)

Os cards de mesa no **Salão do Dono** (`SalonPage.tsx`) e no **App do Garçom** (`WaiterApp.tsx`) utilizam **fundo sólido** (`background: var(--sc-bg)`) com contraste mínimo **WCAG AA** ($\ge 4.5:1$ para texto normal) entre o fundo do card e o texto principal.

## Paleta Sólida de Referência

| Cor | Hex | Texto (`fg`) | Borda (`border`) | Contraste WCAG | Estados mapeados (`TableStatusKind`) |
|---|---|---|---|---|---|
| **Verde** | `#2DBE4E` | `#0F172A` (escuro) | `#1E8E38` | **7.27 : 1** (AAA / AA) | `FREE` — Livre |
| **Amarelo** | `#FFDD00` | `#0F172A` (escuro) | `#CA8A04` | **13.23 : 1** (AAA / AA) | `OCCUPIED` — Ocupada |
| **Vermelho Pedidos** | `#ef4444` | `#0F172A` (escuro) | `#b91c1c` | AA | `NEW_ORDER` — Pedido novo (PENDING/CONFIRMED) |
| **Laranja Pedidos** | `#f97316` | `#0F172A` (escuro) | `#c2410c` | AA | `PREPARING` — Em preparo / produção |
| **Roxo Pedidos** | `#a855f7` | `#0F172A` (escuro) | `#7e22ce` | AA | `READY` — Pronto no balcão |
| **Vermelho** | `#FF5050` | `#0F172A` (escuro) | `#B91C1C` | **5.52 : 1** (AA) | `LONG_STAY` — Ocupada há muito tempo |
| **Marrom sólido** | `#8B5A2B` | `#FFFFFF` (branco) | `#5C3A1B` | **5.85 : 1** (AA) | `BILL` — Conta solicitada; `AUTHORIZED` — conta autorizada (**ambas piscando**) |
| **Marrom + Borda Vermelha** | `#8B5A2B` | `#FFFFFF` (branco) | `#FF5050` (alerta) | **5.85 : 1** (AA) | `AWAITING_PAYMENT` — Aguardando PIX (**piscando + borda vermelha `#FF5050`**) |
| **Roxo** | `#9B4DE0` | `#FFFFFF` (branco) | `#6B21A8` | **4.64 : 1** (AA) | Somente o selo interno em `AUTHORIZED` — Garçom autorizado a fechar |

## Regras Visuais Adicionais

1. **Conta solicitada (`BILL`)**: fundo marrom sólido `#8B5A2B` (mais escuro que `#C4955F`), texto branco `#FFFFFF`, com animação pulsante (`salon-bill-pulse`).
2. **Aguardando PIX (`AWAITING_PAYMENT`)**: mesmo fundo marrom sólido `#8B5A2B` da conta solicitada, piscando (`salon-pix-pulse`), com **borda vermelha de alerta `#FF5050`** (`3px solid`). Permanece ocupada até a confirmação do pagamento.
3. **Garçom autorizado (`AUTHORIZED`)**: mantém o fundo marrom sólido da conta solicitada. Somente o selo interno “Garçom autorizado a fechar esta conta” usa roxo `#9B4DE0` com texto branco `#FFFFFF`; exibe o botão **"Fechar conta"** tanto no Salão quanto no App do Garçom naquela mesa.
4. **Botão "Reabrir conta" / "Pedir mais"**: fundo verde `#2DBE4E` com texto escuro `#0F172A` no app do cliente, no Salão e no App do Garçom.
5. **Legenda visível**: exibida tanto no Salão (`SalonPage.tsx`) quanto na aba Mesas do App do Garçom (`WaiterApp.tsx`).

## Fonte única (Entrega 1.5)

As cores de Pedido novo / Em preparo / Pronto no balcão das mesas são derivadas de `STATUS_COLORS` em `src/lib/orders/statusColors.ts` (mesma paleta do Kanban de Pedidos e das linhas de "Alertas de pedidos" do Dashboard), via `SALON_TABLE_COLORS` em `src/lib/salon/tableStatus.ts`. Não use hex soltos: altere só `statusColors.ts`.

## Entrega 1.5b (04/11) — Servir x Entregue e Alertas do Dashboard

- **Servir (dono, mesa)** leva o pedido de `READY` para `OUT_FOR_DELIVERY` ("Pedido indo até a mesa"). A mesa **continua roxa** (`READY_ROUND_STATUSES` = `READY`, `WAITING_FOR_DRIVER`, `OUT_FOR_DELIVERY`).
- **Entregue (garçom, com ou sem código)** leva a `DELIVERED`: só aí a mesa volta ao **amarelo** (Ocupada).
- **Alertas de pedidos (Dashboard)**: painel e linhas usam `STATUS_COLORS[x].alertBg`, um tom um pouco mais forte que o fundo claro de Pedidos, mantendo o texto `fg` (AA):
  vermelho `#fbd5d5` (novo/atrasado), laranja `#fee2cc` (em preparo), roxo `#ecdcfc` (pronto/servido), verde `#d3efdd`, cinza `#e4e6e9`.
  Prioridade do painel: Atrasados/Novos (vermelho) > Em preparo (laranja) > Prontos (roxo). Linha atrasada segue `LATE` (vermelho sólido).
