import { describe, it, expect } from 'vitest';
import { rpcErrorMessage, mapStrictRpcError, isBusinessRpcCode, RpcBusinessError } from '../rpcErrors';
import { canonicalAuditAction, auditActionMatches } from '../auditActions';
import { parseOwnAvailabilityResponse, driverAvailabilityLabel, parseOwnApprovalResponse } from '../membershipResolution';

describe('fix R3 — erros P04xx', () => {
  it.each([['P0410', 'Conflito de papel'], ['P0413', 'convite pendente'], ['P0414', 'não aprovado'],
           ['P0417', 'Transição inválida'], ['P0418', 'pedido em rota'], ['P0429', 'Muitas tentativas']])(
    '%s vira mensagem amigável', (code, txt) => {
      expect(rpcErrorMessage({ code, message: 'x' })).toContain(txt);
      expect(mapStrictRpcError({ code, message: 'x' })).toContain(txt);
    });
  it('P04xx desconhecido e P0001 preservam a frase do servidor; estrito vira genérico', () => {
    expect(rpcErrorMessage({ code: 'P0499', message: 'Regra X.' })).toBe('Regra X.');
    expect(rpcErrorMessage({ code: 'P0001', message: 'Pedido não encontrado.' })).toBe('Pedido não encontrado.');
    expect(mapStrictRpcError({ code: 'P0499', message: 'Regra X.' })).toMatch(/Não foi possível/);
    expect(isBusinessRpcCode('P0418')).toBe(true);
    expect(isBusinessRpcCode('PGRST116')).toBe(false);
  });
  it('erro inesperado continua sendo erro (nunca sucesso) e mantém o código', () => {
    const e = new RpcBusinessError({ code: 'XX000', message: '' });
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('XX000');
    expect(e.message).toMatch(/Não foi possível/);
  });
});

describe('fix R3 — auditoria', () => {
  it('valor legado REJECTD é exibido como REJECTED e continua buscável pelos dois nomes', () => {
    expect(canonicalAuditAction('DRIVER_APPLICATION_REJECTD')).toBe('DRIVER_APPLICATION_REJECTED');
    expect(canonicalAuditAction('DRIVER_APPLICATION_REJECTED')).toBe('DRIVER_APPLICATION_REJECTED');
    expect(canonicalAuditAction('DRIVER_APPLICATION_APPROVED')).toBe('DRIVER_APPLICATION_APPROVED');
    expect(auditActionMatches('DRIVER_APPLICATION_REJECTD', 'rejectd')).toBe(true);
    expect(auditActionMatches('DRIVER_APPLICATION_REJECTD', 'rejected')).toBe(true);
    expect(auditActionMatches('ORDER_DELETED', 'rejected')).toBe(false);
  });
});

describe('fix R3 — disponibilidade', () => {
  it('lê availability e nunca inventa disponível', () => {
    expect(parseOwnAvailabilityResponse({ approval_status: 'APPROVED', availability: 'UNAVAILABLE' })).toBe('UNAVAILABLE');
    expect(parseOwnAvailabilityResponse({ approval_status: 'APPROVED', availability: 'AVAILABLE' })).toBe('AVAILABLE');
    expect(parseOwnAvailabilityResponse({ approval_status: 'APPROVED' })).toBe('UNKNOWN');
    expect(parseOwnAvailabilityResponse({ availability: 'ONLINE' })).toBe('UNKNOWN');
    expect(parseOwnAvailabilityResponse(null)).toBe('UNKNOWN');
    expect(driverAvailabilityLabel('UNAVAILABLE').label).toBe('Indisponível');
    expect(driverAvailabilityLabel('UNKNOWN').label).not.toMatch(/Dispon[ií]vel$/);
  });
  it('chave nova não altera a leitura de approval_status', () => {
    expect(parseOwnApprovalResponse({ approval_status: 'APPROVED', availability: 'AVAILABLE' })).toBe('APPROVED');
  });
});
