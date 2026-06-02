import React from 'react';

import { ResourceLinkYamlDrawer } from './ResourceLinkYamlDrawer';
import { useHarvesterResourceLinkYamlDrawer } from '../lib/useHarvesterResourceLinkYamlDrawer';

/** 列表页挂载的统一 YAML 抽屉（viewLink 或 staticYaml） */
export function useHarvesterResourceLinkYamlDrawerSlot(cloudId: string | undefined) {
  const drawer = useHarvesterResourceLinkYamlDrawer(cloudId);

  const node = (
    <ResourceLinkYamlDrawer
      open={drawer.yamlDrawerOpen}
      onClose={drawer.closeYamlDrawer}
      cloudId={cloudId}
      viewLink={drawer.yamlViewLink}
      staticYaml={drawer.yamlStaticContent}
      staticSourceLabel={drawer.yamlStaticSourceLabel}
      title={drawer.yamlDrawerTitle ?? '查看 YAML'}
    />
  );

  return { ...drawer, yamlDrawer: node };
}
