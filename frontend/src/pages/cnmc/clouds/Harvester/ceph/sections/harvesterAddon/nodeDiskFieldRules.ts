import { normalizeDeviceNames } from '../../lib/harvesterAddonFormUtils';

export const deviceNamesFieldRules = [
  {
    validator: async (_: unknown, value: unknown) => {
      if (normalizeDeviceNames(value).length < 1) {
        throw new Error('请至少选择一块参与构建存储的硬盘');
      }
    },
  },
];
