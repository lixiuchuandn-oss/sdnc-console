import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { DatacenterRack } from '../../../../../../services/datacenterTopologyApi';
import { clampRackCarouselIndex, findRackIndexBySwitchRef } from '../lib/datacenterTopologySectionUtils';

/** 机柜轮播索引；支持 `?switch_ref=` 深链定位机柜 */
export function useDatacenterRackCarousel(
  cloudId: string,
  racks: DatacenterRack[],
  loading: boolean,
  locationSearch: string,
) {
  const [rackCarouselIndex, setRackCarouselIndex] = useState(0);
  const rackIdsKey = useMemo(() => racks.map((r) => r.id).join('|'), [racks]);

  useLayoutEffect(() => {
    setRackCarouselIndex(0);
  }, [cloudId, rackIdsKey]);

  useEffect(() => {
    if (loading || !racks.length) return;
    const want = new URLSearchParams(locationSearch).get('switch_ref')?.trim();
    if (!want) return;
    const idx = findRackIndexBySwitchRef(racks, want);
    if (idx >= 0) setRackCarouselIndex(idx);
  }, [loading, racks, locationSearch]);

  const carouselCursor = clampRackCarouselIndex(rackCarouselIndex, racks.length);

  return { rackCarouselIndex, setRackCarouselIndex, carouselCursor };
}
