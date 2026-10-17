export const EMAIL_RATE_LIMIT_MSG =
  'Muitos cadastros em pouco tempo: o envio de e-mails de confirmação atingiu o limite. Aguarde alguns minutos e tente novamente.';

/** Erro do Supabase Auth por limite de envio de e-mail (SMTP embutido ~2/h). */
export function isEmailRateLimitError(err: { message?: string; code?: string; status?: number } | null | undefined): boolean {
  if (!err) return false;
  const m = (err.message || '').toLowerCase();
  return err.code === 'over_email_send_rate_limit' || m.includes('email rate limit') || m.includes('over_email_send_rate_limit')
    || (err.status === 429 && m.includes('email'));
}

/** Login com e-mail ainda não confirmado (Supabase: code email_not_confirmed / "Email not confirmed"). */
export function isEmailNotConfirmedError(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === 'email_not_confirmed' || (err.message || '').toLowerCase().includes('email not confirmed');
}

export const INVALID_CREDENTIALS_MSG = 'E-mail ou senha incorretos.';

/** Login com e-mail/senha errados (Supabase: code invalid_credentials / "Invalid login credentials"). */
export function isInvalidCredentialsError(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  const m = (err.message || '').toLowerCase();
  return err.code === 'invalid_credentials' || m.includes('invalid login credentials') || m.includes('invalid credentials');
}

/**
 * A tela cheia "Falha ao Conectar com o Estabelecimento" é só para falha REAL ao carregar os vínculos
 * (tenant_users/permissões). Erro de login (senha errada, e-mail não confirmado, cadastro duplicado,
 * Google) aparece no próprio formulário, nunca nessa tela.
 */
export function isMembershipLoadFailure(membershipStatus: string | null | undefined): boolean {
  return membershipStatus === 'MEMBERSHIP_ERROR';
}
