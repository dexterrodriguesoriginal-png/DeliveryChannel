export function customerWhatsAppLink(phone: string, contactConsent: boolean): string | null {
  if (!contactConsent) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (digits.length < 12 || digits.length > 13) return null;
  return `https://wa.me/${digits}`;
}
