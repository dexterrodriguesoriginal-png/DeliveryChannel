import { describe, it, expect } from 'vitest';
import { dispatchErrorMessage, noApprovedDriverMessage, shouldBlockCallDriver } from '../dispatchErrors';

describe('dispatchErrors: mensagens de "Chamar motoboy" / despacho', () => {
  it('sem entregador aprovado: explica o porquê e onde resolver', () => {
    const m = noApprovedDriverMessage();
    expect(m).toContain('Sua loja ainda não tem entregador aprovado');
    expect(m).toContain('Frota & Entregadores');
  });
  it('bloqueia só com certeza (lista carregada e vazia, por quem pode listar)', () => {
    expect(shouldBlockCallDriver({ canListDrivers: true, driversLoaded: true, approvedCount: 0 })).toBe(true);
    expect(shouldBlockCallDriver({ canListDrivers: true, driversLoaded: true, approvedCount: 1 })).toBe(false);
    expect(shouldBlockCallDriver({ canListDrivers: true, driversLoaded: false, approvedCount: 0 })).toBe(false);
    expect(shouldBlockCallDriver({ canListDrivers: false, driversLoaded: false, approvedCount: 0 })).toBe(false);
  });
  it('traduz os erros reais de assign_order_to_driver', () => {
    expect(dispatchErrorMessage({ code: 'P0414', message: 'Entregador não aprovado neste estabelecimento.' })).toMatch(/ainda não foi aprovado.*Frota & Entregadores/);
    expect(dispatchErrorMessage({ code: 'P0001', message: 'Cadastro operacional de motorista não encontrado para este estabelecimento.' })).toMatch(/não está cadastrado/);
    expect(dispatchErrorMessage({ message: 'O usuário informado não é um motorista ativo deste estabelecimento.' })).toMatch(/não está cadastrado/);
    expect(dispatchErrorMessage({ message: 'Motorista não está disponível para receber novos pedidos (Status atual: BUSY).' })).toMatch(/indisponível/);
    expect(dispatchErrorMessage({ message: 'DRIVER_ALREADY_ASSIGNED: pedido já está com outro entregador; desatribua antes.' })).toMatch(/já está com outro entregador/);
    expect(dispatchErrorMessage({ message: 'O pedido não está pronto para despacho (Status atual: PREPARING).' })).toMatch(/precisa estar "Pronto"/);
    expect(dispatchErrorMessage({ message: 'Permissão negada: somente administradores do estabelecimento podem despachar pedidos.' })).toMatch(/não tem permissão/);
  });
  it('traduz os erros reais de update_order_status', () => {
    expect(dispatchErrorMessage({ code: '42501', message: 'TRANSITION_FORBIDDEN: papel CASHIER não pode mudar o pedido de READY para WAITING_FOR_DRIVER.' })).toMatch(/não tem permissão/);
    expect(dispatchErrorMessage({ message: 'STATUS_UNCHANGED: o pedido já está em WAITING_FOR_DRIVER.' })).toMatch(/já foi chamado/);
    expect(dispatchErrorMessage({ code: '42501', message: 'ORDER_CANCELLED_IS_FINAL: pedido cancelado não pode ser reaberto.' })).toMatch(/cancelado/);
  });
  it('rede e desconhecido viram frase clara, sem prefixo técnico', () => {
    expect(dispatchErrorMessage(new TypeError('Failed to fetch'))).toMatch(/Sem conexão/);
    expect(dispatchErrorMessage({ message: 'WEIRD_CODE: algo deu errado' })).toBe('Não foi possível chamar o entregador: algo deu errado');
    expect(dispatchErrorMessage(null)).toMatch(/Tente de novo/);
  });
});
