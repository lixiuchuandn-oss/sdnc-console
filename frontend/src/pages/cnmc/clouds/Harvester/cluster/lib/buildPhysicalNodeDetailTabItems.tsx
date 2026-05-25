import type { TabsProps } from 'antd';
import { buildHarvesterPhysicalNodeTabItems } from './physicalNodeDetail/harvesterTabItems';
import { buildHmsPhysicalNodeTabItems } from './physicalNodeDetail/hmsTabItems';
import { buildPhysicalNodeDetailDerived } from './physicalNodeDetail/tabModel';
import type { PhysicalNodeDetailTabContext } from './physicalNodeDetail/types';

export type { PhysicalNodeDetailTabContext } from './physicalNodeDetail/types';

export function buildPhysicalNodeDetailTabItems(ctx: PhysicalNodeDetailTabContext): TabsProps['items'] {
  const derived = buildPhysicalNodeDetailDerived(ctx);
  return [
    ...buildHarvesterPhysicalNodeTabItems(ctx, derived),
    ...buildHmsPhysicalNodeTabItems(ctx, derived),
  ];
}
