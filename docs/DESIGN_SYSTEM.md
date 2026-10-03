# ADEGAFOOD — DESIGN SYSTEM & IDENTIDADE VISUAL

## 1. Filosofia de Design
O AdegaFood adota uma identidade visual sóbria, elegante e funcional:
- **Tema Light Dominante**: Fundo clean (`bg-gray-50` e superfícies `bg-white`), tipografia legível e contraste balanceado.
- **Paleta Verde + Branco**: Verde Esmeralda (`#15803d`, `#166534`, `#059669`) comunicando frescor, prosperidade comercial e segurança, associado a cinzas neutros (`#0f172a`, `#475569`, `#e2e8f0`).
- **Sem Estética Gamer ou Gradientes Exagerados**: Foco total na usabilidade rápida por comerciantes ocupados e clientes com smartphones.

## 2. Tipografia
- Fonte primária: `Inter`, com fallback para `system-ui` e suporte a `Plus Jakarta Sans`.
- Escala tipográfica:
  - Título de Página: 20px / 24px (Font-Black / Bold)
  - Subtítulo / Seção: 14px / 16px (Font-Bold)
  - Corpo de Texto: 12px / 13px (Font-Medium)
  - Rótulos & Metadados: 10px / 11px (Font-Mono ou Bold Uppercase)

## 3. Componentes Core
- `Card`: Cantos arredondados (`rounded-2xl`), borda sutil (`border-gray-200/80`) e sombra leve (`shadow-xs`).
- `Button`: Variantes `primary`, `secondary`, `outline`, `danger` e `ghost`, com suporte nativo a `leftIcon`, `rightIcon` e `isLoading`.
- `Badge`: Estados contextuais (`success`, `warning`, `danger`, `brand`, `neutral`).
- `ColorPicker`: Seletor interativo com gradiente 2D, slider de Hue, inputs HEX / RGB / HSL, paleta temática de gastronomia e botões "Aplicar" e "Restaurar Padrão".
- `MobileSimulator`: Moldura realista de iPhone 15 Pro (390 x 844 px) renderizando o app do cliente em tempo real.
