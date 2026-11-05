# Arquivo 6 � Integra��o do Card�pio Premium com o Delivery Channel

Agora vamos conectar o card�pio premium e a tela Meus gastos � aplica��o real, aproveitando os recursos que j� existem.

Arquivo existente: `src/pages/client/DineInClientApp.tsx`

Integra��o localizada

N�o substituir o arquivo inteiro

Verifiquei o c�digo atual dispon�vel no GitHub. Ele j� cont�m `get_my_tab`, `request_bill`, `reopen_tab_from_bill`, `call_waiter`, o controle de mesa por QR e o `TotemKioskLayer`.

Por isso, a implementa��o ser� feita em trechos, todos dentro deste �nico arquivo. Nenhuma migration SQL � necess�ria nesta etapa.

## 1. Adicionar os imports

No in�cio de `DineInClientApp.tsx`, junto aos outros imports:

```

import {
  DineInPremiumMenuAdapter,
} from '../../features/dineInMenu/DineInPremiumMenuAdapter';

```

Adicione tamb�m a chave de ativa��o, fora do componente:

```

/**
 * Ativa��o controlada do Card�pio Premium.
 *
 * O novo layout s� aparece quando:
 * 1. A flag estiver habilitada;
 * 2. O modo totem estiver ativado;
 * 3. O cliente estiver na tela MENU.
 *
 * O restante da aplica��o continua inalterado.
 */
const PREMIUM_TOTEM_ENABLED =
  import.meta.env.VITE_ENABLE_PREMIUM_TOTEM === 'true';

```

## 2. Identificar quando o novo totem est� ativo

O arquivo atual j� possui:

```
const kioskActive =
  menuOptions.totemMode && view === 'MENU';
```

Logo abaixo, acrescentar:

```

const premiumTotemActive =
  PREMIUM_TOTEM_ENABLED &&
  kioskActive &&
  Boolean(storeTenantId);

```

Isso impede que o card�pio premium seja mostrado no aplicativo comum do cliente.

## 3. Reinicializa��o segura do totem

O `resetKioskSession` atual limpa o carrinho e retorna � tela inicial, mas n�o encerra completamente a sess�o autenticada.

Em um totem compartilhado, isso � um risco: o pr�ximo cliente poderia encontrar informa��es do anterior.

Preserve o `resetKioskSession` existente. Acrescente a seguinte fun��o logo depois dele:

```

/**
 * Reset refor�ado, exclusivo do Card�pio Premium.
 *
 * N�o encerra nem libera a mesa no servidor.
 * Apenas limpa a sess�o local do dispositivo.
 */
const resetPremiumKioskSession = useCallback(() => {
  // Executa a limpeza de interface j� existente.
  resetKioskSession();

  // Remove informa��es privadas da sess�o anterior.
  setTab(null);
  setSessionId('');
  setAccountOpen(false);
  setBillOpen(false);

  setIdentityConfirmed(false);
  setEntryApproved(null);
  setEntryRole(null);
  setEntered(false);
  setEntryDone(false);
  setEndedReason(null);

  setPendingApproval(false);
  setAwaitingReleaseModalOpen(false);

  // Elimina a refer�ncia de sess�o do QR.
  try {
    sessionStorage.removeItem(
      `${SESSION_KEY_PREFIX}${token}`,
    );
  } catch {
    // Storage indispon�vel.
  }

  // Garante que a sacola antiga n�o seja restaurada.
  saveDineInCart(
    typeof localStorage !== 'undefined'
      ? localStorage
      : null,
    token,
    [],
    false,
  );

  // Em dispositivo compartilhado, remover tamb�m
  // a autentica��o do usu�rio anterior.
  if (supabaseUser) {
    void Promise.resolve(signOut()).catch(() => {
      // A UI j� foi bloqueada e limpa localmente.
      // O pr�ximo acesso exige nova valida��o.
    });
  }
}, [
  resetKioskSession,
  token,
  supabaseUser,
  signOut,
]);

```

Aten��o: o programador precisa validar o comportamento de `signOut` e da recupera��o autom�tica de sess�o j� existentes. O totem nunca deve reentrar automaticamente na comanda anterior ap�s a limpeza.

No componente `TotemKioskLayer`, onde hoje existe `onIdle={resetKioskSession}`, trocar somente essa propriedade por:

```

onIdle={
  premiumTotemActive
    ? resetPremiumKioskSession
    : resetKioskSession
}

```

## 4. Criar callbacks financeiros espec�ficos do totem

Os m�todos existentes mostram avisos na interface e, em alguns erros, retornam sem lan�ar uma exce��o.

A nova tela `DineInExpenses` precisa saber quando a RPC falhou. Portanto, vamos acrescentar callbacks que chamam as mesmas RPCs existentes, mas devolvem corretamente os erros.

Inserir depois da fun��o `reopenBill` atual:

```

/**
 * Prote��o contra duas solicita��es simult�neas.
 */
const premiumFinanceLockRef = useRef(false);

/**
 * Confirma que os dados carregados pertencem
 * � sess�o atual e aprovada.
 *
 * A autoriza��o definitiva permanece na RPC.
 */
const requirePremiumSession = () => {
  const source = activeIdentityRef.current;

  if (
    !access ||
    !sessionId ||
    needsIdentity ||
    !tab ||
    tab.me?.approved !== true ||
    tab.me.sessionId !== sessionId ||
    source.sessionId !== sessionId ||
    tabClosed
  ) {
    throw new Error(
      'Sess�o inv�lida ou n�o autorizada. ' +
      'Entre novamente na mesa.',
    );
  }

  return source;
};

/**
 * Consulta os gastos novamente no servidor.
 * N�o utiliza valores do carrinho como cobran�a.
 */
const refreshPremiumExpenses = async (): Promise<void> => {
  const source = requirePremiumSession();

  const { data, error: rpcError } =
    await supabase.rpc('get_my_tab', {
      p_session_id: source.sessionId,
    });

  if (!contextMatches(source)) {
    throw new Error(
      'A sess�o mudou durante a consulta.',
    );
  }

  if (rpcError || !data) {
    throw new Error(
      'N�o foi poss�vel atualizar a comanda.',
    );
  }

  const updated = data as MyTab;

  if (
    updated.me?.sessionId !== source.sessionId ||
    updated.me?.approved !== true
  ) {
    throw new Error(
      'Comanda n�o autorizada para esta sess�o.',
    );
  }

  setTab(updated);
};

/**
 * Solicita conta pelo mesmo request_bill j�
 * utilizado no Delivery Channel.
 *
 * N�o realiza pagamento nem libera a mesa.
 */
const requestPremiumBill = async (
  choice: 'CARD' | 'PIX' | 'CAIXA',
): Promise<void> => {
  const source = requirePremiumSession();

  if (
    tab?.status !== 'OPEN' ||
    busy ||
    premiumFinanceLockRef.current
  ) {
    throw new Error(
      'A comanda n�o est� dispon�vel para solicitar a conta.',
    );
  }

  premiumFinanceLockRef.current = true;
  setBusy(true);

  try {
    const { error: rpcError } =
      await supabase.rpc('request_bill', {
        p_session_id: source.sessionId,
        p_choice: choice,
        p_cash_tendered_cents: null,
      });

    if (!contextMatches(source)) {
      throw new Error(
        'A sess�o mudou durante a solicita��o.',
      );
    }

    if (rpcError) {
      // N�o utilizar fallback sem p_choice.
      // A prefer�ncia de pagamento precisa
      // ser realmente registrada pelo servidor.
      throw new Error(
        rpcError.message ||
        'N�o foi poss�vel solicitar a conta.',
      );
    }

    setNotice(
      'Conta solicitada. A equipe foi avisada.',
    );

    // N�o marcar a mesa como paga ou encerrada.
    try {
      await refreshPremiumExpenses();
    } catch {
      setNotice(
        'Solicita��o enviada. Atualize a comanda ' +
        'para consultar o novo status.',
      );
    }
  } finally {
    premiumFinanceLockRef.current = false;

    if (contextMatches(source)) {
      setBusy(false);
    }
  }
};

/**
 * Solicita atendimento usando a RPC atual.
 */
const callWaiterFromPremium = async (): Promise<void> => {
  const source = requirePremiumSession();

  if (busy || premiumFinanceLockRef.current) {
    throw new Error('Aguarde a opera��o anterior.');
  }

  premiumFinanceLockRef.current = true;
  setBusy(true);

  try {
    const { error: rpcError } =
      await supabase.rpc('call_waiter', {
        p_session_id: source.sessionId,
        p_type: 'CALL',
      });

    if (!contextMatches(source)) {
      throw new Error('A sess�o mudou.');
    }

    if (rpcError) {
      throw new Error(
        rpcError.message ||
        'N�o foi poss�vel chamar o gar�om.',
      );
    }

    setNotice(
      'Gar�om chamado. Aguarde o atendimento.',
    );
  } finally {
    premiumFinanceLockRef.current = false;

    if (contextMatches(source)) {
      setBusy(false);
    }
  }
};

/**
 * Reabre a comanda usando o controle existente.
 * O servidor bloqueia reabertura durante PIX
 * ou ap�s pagamento confirmado.
 */
const reopenBillFromPremium = async (): Promise<void> => {
  const source = requirePremiumSession();

  if (
    !canReopenBill(tab?.status, tab?.pixStatus) ||
    busy ||
    premiumFinanceLockRef.current
  ) {
    throw new Error(
      'Esta comanda n�o pode ser reaberta agora.',
    );
  }

  premiumFinanceLockRef.current = true;
  setBusy(true);

  try {
    const { error: rpcError } =
      await supabase.rpc('reopen_tab_from_bill', {
        p_session_id: source.sessionId,
      });

    if (!contextMatches(source)) {
      throw new Error('A sess�o mudou.');
    }

    if (rpcError) {
      throw new Error(
        'N�o foi poss�vel reabrir a comanda. ' +
        'Consulte a equipe.',
      );
    }

    setNotice(
      'Comanda reaberta. Voc� pode continuar pedindo.',
    );

    try {
      await refreshPremiumExpenses();
    } catch {
      setNotice(
        'Reabertura enviada. Atualize o status ' +
        'da comanda antes de continuar.',
      );
    }
  } finally {
    premiumFinanceLockRef.current = false;

    if (contextMatches(source)) {
      setBusy(false);
    }
  }
};

```

Observa��o de implementa��o: esse trecho usa `useRef` e, portanto, o `premiumFinanceLockRef` deve ser declarado junto aos demais hooks do componente, n�o dentro de uma fun��o condicional ou depois de um `return`. As fun��es auxiliares podem permanecer junto dos m�todos de conta.

O caminho financeiro continua:

Cliente solicita a conta

RPC `request_bill`

Status `BILL_REQUESTED` no servidor

Mesa marrom piscando no Sal�o, Dashboard e Gar�om

Pagamento confirmado pelo backend &#8594; libera��o da mesa

O c�digo do Sal�o j� possui a cor marrom para conta solicitada. A atualiza��o visual do Dashboard e do App do Gar�om dever� ser conferida na integra��o; este arquivo n�o altera esses componentes.

## 5. Conectar o novo componente ao card�pio existente

Localize no arquivo o trecho que decide entre `StoreHomeScreen` e `DineInTotemMenu`.

Hoje a alternativa do card�pio utiliza `DineInTotemMenu`.

O novo fluxo deve manter esse componente antigo como alternativa quando a flag estiver desligada.

Substituir somente a express�o do card�pio, n�o o componente da tela inicial:

```

premiumTotemActive ? (
  <DineInPremiumMenuAdapter
    key={`${token}:${storeTenantId}:${sessionId}`}

    tenantId={storeTenantId}
    storeName={storeName}
    storeLogoUrl={storeLogoUrl}
    storeTagline="Bem-vindo ao nosso card�pio"

    // Este fluxo � um QR de mesa.
    // Totem de balc�o ter� que ser provisionado
    // separadamente com sua pr�pria identidade.
    location="TABLE"

    tableLabel={mesaTitle(
      tab?.tableLabel ||
      resolution?.tableLabel,
    )}

    categories={categories}
    products={products}

    menuTheme={menuTheme}
    homeDesign={storeHomeDesign}

    cartCount={totalCartItems}
    orderingDisabled={orderingDisabled}
    busy={busy}

    verifiedSessionId={sessionId}
    tabSessionId={tab?.me?.sessionId ?? null}

    sessionAuthorized={Boolean(
      access &&
      !needsIdentity &&
      tab?.me?.approved === true &&
      tab.me.sessionId === sessionId
    )}

    tab={tab}

    // N�o presumir autoriza��o para exibir
    // os gastos de outros clientes da mesa.
    // Ativar somente ap�s verificar o contrato
    // real de get_my_tab para o respons�vel.
    authorizedTableScope={false}

    onGoHome={resetPremiumKioskSession}

    onOpenCart={() => {
      upsell.dismiss();
      setCartOpen(true);
    }}

    onOpenTable={() => {
      if (
        sessionId &&
        tab?.me?.approved === true
      ) {
        setAccountOpen(true);
        void loadAccount(true);
      }
    }}

    onAddProduct={addItem}

    onOpenProduct={product => {
      if (!orderingDisabled && !busy) {
        optionsFromUpsell.current = false;
        setOptionsProduct(product);
        setOptionChoices([]);
      }
    }}

    onRequestBill={requestPremiumBill}
    onCallWaiter={callWaiterFromPremium}
    onReopenBill={reopenBillFromPremium}
    onRefreshExpenses={refreshPremiumExpenses}
  />
) : (
  <DineInTotemMenu
    key={`${token}:${storeTenantId}`}
    storeSlug={resolution?.tenantSlug || ''}
    storeTenantId={storeTenantId}
    storeName={storeName}
    logoUrl={storeLogoUrl}
    categories={categories}
    products={products}
    menuTheme={menuTheme}
    cartCount={totalCartItems}
    orderingDisabled={orderingDisabled}
    busy={busy}
    onAddProduct={addItem}
    onOpenProduct={product => {
      if (!orderingDisabled && !busy) {
        optionsFromUpsell.current = false;
        setOptionsProduct(product);
        setOptionChoices([]);
      }
    }}
    onOpenCart={() => {
      upsell.dismiss();
      setCartOpen(true);
    }}
    onBack={
      kioskActive
        ? undefined
        : () => setView('HOME')
    }
  />
)

```

Essa express�o deve entrar como a alternativa de `view === 'HOME'` no JSX j� existente. N�o � um segundo `return` independente.

## 6. Evitar cabe�alhos e barras duplicadas

O `DineInPremiumMenuAdapter` j� possui seu pr�prio cabe�alho e barra inferior.

No `DineInClientApp.tsx`, o cabe�alho antigo deve aparecer apenas quando o card�pio premium n�o estiver ativo.

Onde existe:

```
{view === 'HOME' ? (
  // ...
) : (
  <header>
    ...
  </header>
)}
```

Ajustar para:

```

{view === 'HOME' ? (
  // Manter exatamente o cabe�alho HOME existente.
) : !premiumTotemActive ? (
  // Manter exatamente o header antigo do MENU.
  <header>
    {/* conte�do original preservado */}
  </header>
) : null}

```

O bloco de navega��o antiga `view === 'MENU' && <nav aria-label="A��es da mesa"...>` deve utilizar:

```

{view === 'MENU' && !premiumTotemActive && (
  // Manter aqui a navega��o antiga completa,
  // sem alterar seus bot�es ou callbacks.
)}

```

E o cont�iner principal do card�pio deve ficar sobre a tela inteira, sem outro layout restringindo a altura:

```

<section
  className={
    premiumTotemActive
      ? 'fixed inset-0 z-20 overflow-hidden'
      : view === 'MENU'
        ? 'dinein-menu-content'
        : view === 'HOME'
          ? 'dc-store-home-host'
          : 'mx-auto max-w-2xl px-4 py-5'
  }
>
  {/* Conte�do original da se��o,
      com o novo adaptador na alternativa MENU. */}
</section>

```

Os modais de carrinho, op��es de produto e confirma��o do pedido devem continuar funcionando acima desse cont�iner. O programador dever� conferir as camadas (`z-index`) e os avisos de QR pausado, mesa aguardando libera��o e tracking, para que n�o sejam encobertos pelo layout em tela cheia.

## 7. A chave de ativa��o

Para homologa��o, configurar o ambiente de desenvolvimento/staging com:

```
VITE_ENABLE_PREMIUM_TOTEM=false
```

Assim, o card�pio antigo continua funcionando enquanto a integra��o � testada.

Depois de validar os componentes e permiss�es no ambiente autorizado, a flag poder� ser ativada somente nesse ambiente de teste.

## Checklist de homologa��o

| Teste                  | Comportamento esperado                           |
| ---------------------- | ------------------------------------------------ |
| Flag desligada         | Card�pio anterior intacto                        |
| Totem ligado           | Layout premium em tela grande                    |
| App cliente comum      | Sem altera��o                                    |
| Carrinho               | Produtos e adicionais preservados                |
| Meus gastos sem sess�o | Acesso bloqueado                                 |
| Meus gastos autorizado | Dados da sess�o correta                          |
| Fechar conta           | Chama `request_bill`                             |
| Chamar gar�om          | Chama `call_waiter`                              |
| Reabrir comanda        | Chama `reopen_tab_from_bill`                     |
| Conta solicitada       | Mesa marrom piscando nos pain�is correspondentes |
| Pagamento pendente     | Mesa continua ocupada                            |
| Pagamento confirmado   | Somente backend pode liberar                     |
| Inatividade no totem   | Informa��es privadas e sess�o anterior limpas    |

### Pend�ncias t�cnicas que o programador deve observar

O componente `DineInPremiumMenuAdapter` enviado anteriormente pressup�e que a sess�o j� foi carregada e autorizada. A integra��o acima utiliza `tab.me.sessionId`, retornado pelo backend, para vincular os gastos � sess�o atual. Se o `get_my_tab` do ambiente n�o fornecer esse identificador, a interface deve continuar bloqueada at� que o contrato seja validado � n�o criar um identificador fict�cio.

Tamb�m h� uma diferen�a de estrutura entre os c�digos propostos e o reposit�rio consultado: a Tela Inicial atual utiliza `src/lib/storeHome/storeHome.model.ts`, enquanto alguns dos arquivos novos foram escritos com import de `src/features/storeHome/storeHome.model.ts`. Os imports devem ser padronizados para o m�dulo real antes da compila��o, sem duplicar o motor de temas.

Por fim, o fluxo de totem no balc�o ainda exige uma identidade pr�pria de dispositivo e uma autoriza��o de sess�o espec�fica. Esta integra��o est� preparada para o totem vinculado ao QR de uma mesa; n�o deve ser ativada indiscriminadamente em totens compartilhados de balc�o antes de resolver esse controle.

Status: arquivo 6 entregue como instru��es de integra��o, ainda n�o aplicado, compilado ou homologado. Nenhuma altera��o foi feita no GitHub, `main` ou Supabase.

Pr�ximo arquivo (7): `src/features/dineInMenu/dineInMenu.model.test.ts` � testes automatizados do cat�logo, categorias, pre�os, isolamento por estabelecimento e c�lculo de Meus gastos.