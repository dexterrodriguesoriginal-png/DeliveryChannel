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
