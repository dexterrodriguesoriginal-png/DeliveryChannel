/**
 * Endereço canônico do app da loja: sempre com a barra final (/app/<slug>/).
 *
 * O manifesto da loja declara scope "/app/<slug>/". Aberta como "/app/<slug>" (sem barra), a página
 * fica FORA do escopo do app e fora do controle do Service Worker (registrado em "/app/<slug>/").
 * Foi assim que o app da loja acabou instalado como atalho comum (não aparece em chrome://webapks e
 * nunca recebe cor/ícone novos), enquanto o Totem, instalado de "/totem/<slug>/", virou WebAPK.
 * Por isso a vitrine sempre é servida dentro do escopo: o servidor redireciona e o cliente normaliza.
 */
const STORE_ROOT_NO_SLASH = /^\/app\/([^/.]+)$/;

/** "/app/<slug>" → "/app/<slug>/" + query; qualquer outro caminho (já canônico, subpáginas, arquivos) → null. */
export function storeAppCanonicalPath(pathname: string, search = ''): string | null {
  const m = STORE_ROOT_NO_SLASH.exec(pathname);
  if (!m || !m[1]) return null;
  const query = search && search !== '?' ? (search.startsWith('?') ? search : `?${search}`) : '';
  return `/app/${m[1]}/${query}`;
}
