import { useCallback, useState } from 'react';
import { message } from 'antd';
import yaml from 'js-yaml';
import { getCephBlockPoolRook } from '../../../../../../services/cephApi';
import type { CephPoolTableRow } from '../lib/cephStorage';

export function useCephPoolYamlDrawer(cloudId: string): {
  yamlOpen: boolean;
  yamlTitle: string;
  yamlText: string;
  yamlLoading: boolean;
  openPoolYaml: (row: CephPoolTableRow) => Promise<void>;
  closeYamlDrawer: () => void;
} {
  const [yamlOpen, setYamlOpen] = useState(false);
  const [yamlTitle, setYamlTitle] = useState('');
  const [yamlText, setYamlText] = useState('');
  const [yamlLoading, setYamlLoading] = useState(false);

  const openPoolYaml = useCallback(
    async (row: CephPoolTableRow) => {
      const ns = row.namespace?.trim();
      const nm = row.name?.trim();
      setYamlOpen(true);
      setYamlLoading(true);
      setYamlText('');

      if (row.source === 'rook' && ns && nm && ns !== '—') {
        setYamlTitle(`CephBlockPool · ${ns}/${nm}`);
        try {
          const res = await getCephBlockPoolRook(cloudId, ns, nm);
          if (!res.ok || res.data == null) {
            message.error(res.error || '拉取 CephBlockPool 失败');
            setYamlText('# 加载失败');
            return;
          }
          setYamlText(yaml.dump(res.data, { lineWidth: 120, noRefs: true }));
        } finally {
          setYamlLoading(false);
        }
        return;
      }

      if (row.detailRaw != null && typeof row.detailRaw === 'object') {
        setYamlTitle(`存储池 · ${nm || row.name}`);
        setYamlText(yaml.dump(row.detailRaw, { lineWidth: 120, noRefs: true }));
        setYamlLoading(false);
        return;
      }

      message.warning('无法查看 YAML：缺少资源详情');
      setYamlOpen(false);
      setYamlLoading(false);
    },
    [cloudId],
  );

  const closeYamlDrawer = useCallback(() => setYamlOpen(false), []);

  return { yamlOpen, yamlTitle, yamlText, yamlLoading, openPoolYaml, closeYamlDrawer };
}
