import { useCallback, useState } from 'react';
import { message } from 'antd';
import yaml from 'js-yaml';
import { getCephRadosNamespaceRook, getCephRbdMirrorRook } from '../../../../../../../services/cephApi';

export type CephBlockYamlTarget =
  | { kind: 'rados'; namespace: string; name: string }
  | { kind: 'mirror'; namespace: string; name: string };

export function useCephBlockYamlDrawer(cloudId: string): {
  yamlOpen: boolean;
  yamlTitle: string;
  yamlText: string;
  yamlLoading: boolean;
  openYamlDrawer: (t: CephBlockYamlTarget) => Promise<void>;
  closeYamlDrawer: () => void;
} {
  const [yamlOpen, setYamlOpen] = useState(false);
  const [yamlTitle, setYamlTitle] = useState('');
  const [yamlText, setYamlText] = useState('');
  const [yamlLoading, setYamlLoading] = useState(false);

  const openYamlDrawer = useCallback(
    async (t: CephBlockYamlTarget) => {
      setYamlOpen(true);
      setYamlLoading(true);
      setYamlText('');
      try {
        if (t.kind === 'rados') {
          setYamlTitle(`RADOS 命名空间 · ${t.namespace}/${t.name}`);
          const res = await getCephRadosNamespaceRook(cloudId, t.namespace, t.name);
          if (!res.ok || res.data == null) {
            message.error(res.error || '拉取详情失败');
            setYamlText('# 加载失败');
            return;
          }
          setYamlText(yaml.dump(res.data, { lineWidth: 120, noRefs: true }));
          return;
        }
        setYamlTitle(`RBD Mirror · ${t.namespace}/${t.name}`);
        const res = await getCephRbdMirrorRook(cloudId, t.namespace, t.name);
        if (!res.ok || res.data == null) {
          message.error(res.error || '拉取详情失败');
          setYamlText('# 加载失败');
          return;
        }
        setYamlText(yaml.dump(res.data, { lineWidth: 120, noRefs: true }));
      } finally {
        setYamlLoading(false);
      }
    },
    [cloudId],
  );

  const closeYamlDrawer = useCallback(() => setYamlOpen(false), []);

  return { yamlOpen, yamlTitle, yamlText, yamlLoading, openYamlDrawer, closeYamlDrawer };
}
