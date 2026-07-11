import { AppDataSource } from '../../config/database';
import { NATAddressGroup } from '../../entities/vRouter/NATAddressGroup';
import { VRConfig } from '../../entities/vRouter/VRConfig';

const groupRepo = () => AppDataSource.getRepository(NATAddressGroup);
const vrConfigRepo = () => AppDataSource.getRepository(VRConfig);

export type NatAddressGroupDeviceRow = {
  group_id: number;
  range: string[];
  static_mapping: Array<{
    proto: string;
    inside: string;
    local_port: number;
    outside: string;
    external_port: number;
    vrf?: string;
    twice_nat?: string;
  }>;
};

/** 将平台 NAT 表同步进 vr_config.config_json 的 nat_address_group */
export const syncNatToVRConfig = async (vrId: string): Promise<Record<string, unknown>> => {
  if (!vrId) return {};

  const groups = await groupRepo().find({
    where: { vrId },
    relations: ['mappings'],
    order: { deviceGroupId: 'ASC' },
  });

  const natAddressGroup: NatAddressGroupDeviceRow[] = groups.map((g) => ({
    group_id: g.deviceGroupId,
    range: Array.isArray(g.range) ? g.range : [],
    static_mapping: (g.mappings || [])
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((m) => {
        const row: NatAddressGroupDeviceRow['static_mapping'][number] = {
          proto: m.proto,
          inside: m.inside,
          local_port: m.localPort,
          outside: m.outside,
          external_port: m.externalPort,
        };
        const vrf = String(m.vrf || '').trim();
        const twiceNat = String(m.twiceNat || '').trim();
        if (vrf) row.vrf = vrf;
        if (twiceNat) row.twice_nat = twiceNat;
        return row;
      }),
  }));

  let vr = await vrConfigRepo().findOne({ where: { uuid: vrId } });
  if (!vr) {
    vr = vrConfigRepo().create({ uuid: vrId, config_json: '{}' });
  }

  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(vr.config_json) as Record<string, unknown>;
  } catch {
    config = {};
  }

  config.nat_address_group = natAddressGroup;
  vr.config_json = JSON.stringify(config);
  await vrConfigRepo().save(vr);

  return config;
};

export const parseRangeInput = (input: unknown): string[] => {
  if (Array.isArray(input)) {
    return input.map((x) => String(x).trim()).filter(Boolean);
  }
  const text = String(input ?? '').trim();
  if (!text) return [];
  return text.split(/[\n,;，；\s]+/).map((s) => s.trim()).filter(Boolean);
};
