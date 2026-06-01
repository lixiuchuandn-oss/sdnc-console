export type Srv6TunnelLike = {
  id?: string;
  name?: string;
  peA?: string;
  peB?: string;
  ceA?: string;
  ceB?: string;
};

export type Srv6TunnelPayload = {
  name: string;
  peA: string;
  peB: string;
  ceA: string;
  ceB: string;
};

type NormalizeResult = { ok: true; value: Srv6TunnelPayload } | { ok: false; message: string };

const normalizeText = (value: unknown) => String(value ?? '').trim();

const sameId = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');

const sameName = (a: unknown, b: unknown) =>
  normalizeText(a).toLowerCase() === normalizeText(b).toLowerCase();

export const normalizeSrv6TunnelPayload = (payload: unknown): NormalizeResult => {
  const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const value = {
    name: normalizeText(body.name),
    peA: normalizeText(body.peA),
    peB: normalizeText(body.peB),
    ceA: normalizeText(body.ceA),
    ceB: normalizeText(body.ceB),
  };

  if (!value.name || !value.peA || !value.peB || !value.ceA || !value.ceB) {
    return { ok: false, message: '缺少必要字段：name, peA, peB, ceA, ceB' };
  }
  if (sameId(value.peA, value.peB)) {
    return { ok: false, message: 'PE-A 与 PE-B 不能相同' };
  }
  if (sameId(value.ceA, value.ceB)) {
    return { ok: false, message: 'CE-A 与 CE-B 不能相同' };
  }

  return { ok: true, value };
};

export const hasSrv6NameConflict = (tunnels: Srv6TunnelLike[], name: string, excludeId?: string) =>
  tunnels.some((item) => (!excludeId || !sameId(item.id, excludeId)) && sameName(item.name, name));

const endpointsMatch = (a: Srv6TunnelLike, b: Srv6TunnelLike) =>
  sameId(a.peA, b.peA) && sameId(a.peB, b.peB) && sameId(a.ceA, b.ceA) && sameId(a.ceB, b.ceB);

const endpointsMatchSymmetric = (a: Srv6TunnelLike, b: Srv6TunnelLike) =>
  sameId(a.peA, b.peB) && sameId(a.peB, b.peA) && sameId(a.ceA, b.ceB) && sameId(a.ceB, b.ceA);

export const hasSrv6EndpointConflict = (
  tunnels: Srv6TunnelLike[],
  payload: Srv6TunnelLike,
  excludeId?: string,
) =>
  tunnels.some(
    (item) =>
      (!excludeId || !sameId(item.id, excludeId)) &&
      (endpointsMatch(item, payload) || endpointsMatchSymmetric(item, payload)),
  );
