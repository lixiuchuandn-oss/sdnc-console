import { message } from 'antd';
import { useCallback, useState } from 'react';

import { resolveHarvesterSteveViewLink } from './harvesterSteveViewLink';

export type OpenHarvesterYamlDrawerOptions = {
  title?: string;
  resolveLink?: (record: unknown) => string | undefined;
};

/** 列表行「查看 YAML」→ ResourceLinkYamlDrawer 状态 */
export function useHarvesterResourceLinkYamlDrawer(cloudId: string | undefined) {
  const [yamlDrawerOpen, setYamlDrawerOpen] = useState(false);
  const [yamlViewLink, setYamlViewLink] = useState<string | undefined>();
  const [yamlDrawerTitle, setYamlDrawerTitle] = useState<string | undefined>();

  const openYamlDrawer = useCallback(
    (record: unknown, options?: OpenHarvesterYamlDrawerOptions) => {
      if (!cloudId) {
        message.warning('缺少云实例上下文，无法拉取 YAML');
        return;
      }
      const link = (options?.resolveLink ?? resolveHarvesterSteveViewLink)(record);
      if (!link) {
        message.warning('当前行缺少 View Link，无法拉取 YAML');
        return;
      }
      setYamlViewLink(link);
      setYamlDrawerTitle(options?.title);
      setYamlDrawerOpen(true);
    },
    [cloudId],
  );

  const closeYamlDrawer = useCallback(() => {
    setYamlDrawerOpen(false);
    setYamlViewLink(undefined);
    setYamlDrawerTitle(undefined);
  }, []);

  return {
    yamlDrawerOpen,
    yamlViewLink,
    yamlDrawerTitle,
    openYamlDrawer,
    closeYamlDrawer,
  };
}
