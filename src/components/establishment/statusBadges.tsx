import React from 'react';
import { Badge, BadgeProps } from '../ui/Badge';
import { TeamMemberStatus, DriverApprovalStatus } from '../../types';

type Variant = NonNullable<BadgeProps['variant']>;

/** Selos de tenant_users.status (vínculo). Reaproveita o Badge existente; sem estilos novos. */
export const TEAM_MEMBER_STATUS_BADGE: Record<TeamMemberStatus, { label: string; variant: Variant }> = {
  ACTIVE: { label: 'Ativo', variant: 'success' },
  PENDING: { label: 'Aguardando aprovação', variant: 'warning' },
  SUSPENDED: { label: 'Suspenso', variant: 'danger' },
  INVITED: { label: 'Convidado', variant: 'info' },
  INACTIVE: { label: 'Inativo', variant: 'neutral' },
};

export const TeamMemberStatusBadge: React.FC<{ status: TeamMemberStatus }> = ({ status }) => {
  const cfg = TEAM_MEMBER_STATUS_BADGE[status] ?? TEAM_MEMBER_STATUS_BADGE.INACTIVE;
  return <Badge variant={cfg.variant} size="sm">{cfg.label}</Badge>;
};

/** Selos de drivers.approval_status (aprovação na loja), separados do selo de disponibilidade. */
export const DRIVER_APPROVAL_BADGE: Record<DriverApprovalStatus | 'UNKNOWN', { label: string; variant: Variant }> = {
  UNKNOWN: { label: 'Aprovação não confirmada', variant: 'neutral' },
  APPROVED: { label: 'Aprovado', variant: 'success' },
  PENDING: { label: 'Pendente', variant: 'warning' },
  SUSPENDED: { label: 'Suspenso', variant: 'danger' },
  REJECTED: { label: 'Rejeitado', variant: 'neutral' },
  REMOVED: { label: 'Removido', variant: 'neutral' },
};

export const DriverApprovalBadge: React.FC<{ status: DriverApprovalStatus | 'UNKNOWN' }> = ({ status }) => {
  const cfg = DRIVER_APPROVAL_BADGE[status] ?? DRIVER_APPROVAL_BADGE.UNKNOWN;
  return <Badge variant={cfg.variant} size="sm">{cfg.label}</Badge>;
};
