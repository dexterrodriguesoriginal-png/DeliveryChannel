# Paleta e Legenda das Mesas (Salão do Dono e App do Garçom)

Os cards de mesa no **Salão do Dono** (`SalonPage.tsx`) e no **App do Garçom** (`WaiterApp.tsx`) utilizam **fundo sólido** (`background: var(--sc-bg)`) com contraste mínimo **WCAG AA** ($\ge 4.5:1$ para texto normal) entre o fundo do card e o texto principal.

## Paleta Sólida de Referência

| Cor | Hex | Texto (`fg`) | Borda (`border`) | Contraste WCAG | Estados mapeados (`TableStatusKind`) |
|---|---|---|---|---|---|
| **Verde** | `#2DBE4E` | `#0F172A` (escuro) | `#1E8E38` | **7.27 : 1** (AAA / AA) | `FREE` — Livre |
| **Amarelo** | `#FFDD00` | `#0F172A` (escuro) | `#CA8A04` | **13.23 : 1** (AAA / AA) | `OCCUPIED` — Ocupada<br>`PREPARING` — Em preparo |
| **Azul** | `#1AB0F5` | `#0F172A` (escuro) | `#0284C7` | **7.26 : 1** (AAA / AA) | `NEW_ORDER` — Pedido novo<br>`READY` — Pronto no balcão |
| **Vermelho** | `#FF5050` | `#0F172A` (escuro) | `#B91C1C` | **5.52 : 1** (AA) | `LONG_STAY` — Ocupada há muito tempo |
| **Marrom sólido** | `#8B5A2B` | `#FFFFFF` (branco) | `#5C3A1B` | **5.85 : 1** (AA) | `BILL` — Conta solicitada (**piscando**) |
| **Marrom + Borda Vermelha** | `#8B5A2B` | `#FFFFFF` (branco) | `#FF5050` (alerta) | **5.85 : 1** (AA) | `AWAITING_PAYMENT` — Aguardando PIX (**piscando + borda vermelha `#FF5050`**) |
| **Roxo** | `#9B4DE0` | `#FFFFFF` (branco) | `#6B21A8` | **4.64 : 1** (AA) | `AUTHORIZED` — Garçom autorizado a fechar |

## Regras Visuais Adicionais

1. **Conta solicitada (`BILL`)**: fundo marrom sólido `#8B5A2B` (mais escuro que `#C4955F`), texto branco `#FFFFFF`, com animação pulsante (`salon-bill-pulse`).
2. **Aguardando PIX (`AWAITING_PAYMENT`)**: mesmo fundo marrom sólido `#8B5A2B` da conta solicitada, piscando (`salon-pix-pulse`), com **borda vermelha de alerta `#FF5050`** (`3px solid`). Permanece ocupada até a confirmação do pagamento.
3. **Garçom autorizado (`AUTHORIZED`)**: fundo roxo sólido `#9B4DE0` com texto branco `#FFFFFF`; exibe o botão **"Fechar conta"** tanto no Salão quanto no App do Garçom naquela mesa.
4. **Botão "Reabrir conta" / "Pedir mais"**: fundo verde `#2DBE4E` com texto escuro `#0F172A` no app do cliente, no Salão e no App do Garçom.
5. **Legenda visível**: exibida tanto no Salão (`SalonPage.tsx`) quanto na aba Mesas do App do Garçom (`WaiterApp.tsx`).
