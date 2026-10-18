/** CPF: só dígitos, máscara e validação dos dígitos verificadores (Receita Federal). */
export function cpfDigits(v: string | null | undefined): string {
  return String(v ?? '').replace(/\D/g, '').slice(0, 11);
}

export function formatCPF(v: string | null | undefined): string {
  const d = cpfDigits(v);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function isValidCPF(v: string | null | undefined): boolean {
  const raw = String(v ?? '').replace(/[.\-\s]/g, '');
  if (!/^\d{11}$/.test(raw)) return false;
  if (/^(\d)\1{10}$/.test(raw)) return false; // 000.000.000-00, 111... etc.
  const n = raw.split('').map(Number);
  const dv = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += n[i] * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === n[9] && dv(10) === n[10];
}

/** Exibição mascarada (LGPD): ***.456.789-** */
export function maskCPF(v: string | null | undefined): string {
  const d = cpfDigits(v);
  if (d.length !== 11) return '';
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}
