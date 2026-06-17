/** P5：SRv6 PE 侧 VR 角色（取代原 PE） */

import type { Srv6TunnelTopology } from '../../entities/vRouter/srv6Tunnel.types';

export const SRV6_PE_ROLES = ['SPOKE_PE', 'HUB_PE'] as const;
export type Srv6PeRole = (typeof SRV6_PE_ROLES)[number];

export const normalizeVrRole = (role: unknown): string =>
  String(role ?? '')
    .trim()
    .toUpperCase();

export const isSrv6PeRole = (role: unknown): role is Srv6PeRole =>
  (SRV6_PE_ROLES as readonly string[]).includes(normalizeVrRole(role));

export const isLegacyPeRole = (role: unknown): boolean => normalizeVrRole(role) === 'PE';

export const parseTunnelTopology = (value: unknown): Srv6TunnelTopology =>
  normalizeVrRole(value) === 'H' ? 'H' : 'S';
