# E-mails com a identidade da loja

O responsável pelo Supabase aplica estes templates em **staging**, confere os links e só depois repete em produção. O PR não altera configurações remotas de Auth/SMTP.

Em **Authentication → Email Templates** (em algumas versões: Auth → Templates), copie o HTML correspondente:

| Template no painel | Arquivo | Assunto sugerido |
| --- | --- | --- |
| Confirm signup | `supabase/templates/confirmation.html` | Confirme seu cadastro na loja |
| Magic Link | `supabase/templates/magic_link.html` | Seu acesso à loja |
| Reset Password | `supabase/templates/recovery.html` | Crie uma nova senha |

O cabeçalho usa `{{ .Data.store_name }}` e o rodapé discreto diz “enviado por Delivery Channel”. Sem esse metadado em contas antigas, aparece “Delivery Channel”. Preserve `{{ .ConfirmationURL }}`: é o link assinado pelo Supabase. Não substitua por URL montada na aplicação e não inclua tokens, nomes de clientes ou entregadores no assunto/HTML/logs. O nome público da loja é limitado a 100 caracteres; nunca é usado como autorização de tenant.

No cadastro por e-mail, cliente e entregador enviam `store_name` em `signUp({ options: { data } })`, usando o nome da vitrine ou do QR. O reenvio usa o metadado já associado ao usuário. Recuperação usa o último nome gravado nessa conta: a API `resetPasswordForEmail` não aceita `data` nem permite atualizar metadados de alguém sem sessão.

**OAuth do Google:** `signInWithOAuth` do Supabase não aceita `options.data`. O app guarda apenas o nome público da loja em sessionStorage antes do redirecionamento e, após o retorno autenticado, grava `updateUser({ data: { store_name } })`. Isso mantém a mesma conta e não pede nova confirmação. O e-mail do próprio Google é controlado pelo Google; os templates acima valem para mensagens enviadas pelo Supabase. Uma conta usada em várias lojas mantém o último nome gravado, pois os metadados de Auth são por usuário, não por tenant.

Em **Authentication → Email → SMTP Settings** configure remetente e SMTP próprio. O **Sender name** é uma configuração global do projeto; use “Delivery Channel” ou o nome do serviço definido pelo responsável. A identidade variável de cada loja fica no cabeçalho. Não cadastre credenciais SMTP no repositório.

Confira a allow-list de Redirect URLs para `/app/<slug>`, `/convite-entregador` e `/entregador/convite`, conforme o domínio de staging/produção. Antes de editar templates e SMTP, exporte/copie a configuração atual para rollback. Para reverter, restaure os três HTMLs anteriores no painel e o remetente anterior; não há migration de banco para o item 6.

Validação em staging: cadastrar um cliente na loja A e um entregador pelo QR da loja B; conferir os respectivos cabeçalhos, confirmação, retorno para a loja correta, magic link e recuperação; testar também uma conta antiga sem `store_name` e a mesma conta Google em duas lojas. Não copie links reais para logs ou evidências públicas.
