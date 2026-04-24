import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../../components/PageDetailSection';
import {
  fetchRancherClusterDetail,
  type RancherClusterDetail,
} from '../../../../../../../services/rancherClusterApi';
import { fetchCloudById } from '../../../../../../../services/api';

type Props = { poolId: string; clusterId: string };

const ClusterToolsPanel: React.FC<Props> = ({ poolId, clusterId }) => {
  const [detail, setDetail] = useState<RancherClusterDetail | null>(null);
  const [rancherUi, setRancherUi] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!poolId || !clusterId) return;
    setLoading(true);
    setErr(null);
    try {
      const [d, cloud] = await Promise.all([
        fetchRancherClusterDetail(poolId, clusterId),
        fetchCloudById(poolId, { skipCache: false }).catch(() => null),
      ]);
      setDetail(d);
      const base = String(
        (cloud as any)?.config?.rancherUrl || (cloud as any)?.endpoint || '',
      ).trim();
      if (base) {
        try {
          const u = new URL(base.startsWith('http') ? base : `https://${base}`);
          setRancherUi(u.origin);
        } catch {
          setRancherUi(base);
        }
      } else {
        setRancherUi('');
      }
    } catch (e: any) {
      setErr(e?.message || '加载失败');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [poolId, clusterId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!poolId || !clusterId) {
    return <Alert type="warning" message="缺少资源池或集群参数" showIcon />;
  }

  return (
    <PageDetailSection asCard={false}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <div className="toolbar-actions">
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()} />
        </div>
      </div>
      {err && <Alert type="error" message={err} showIcon style={{ marginBottom: 16 }} />}
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        与 Rancher「工具」类似：查看集群元数据；kubectl / kubeconfig 等请在 Rancher 控制台完成。
      </Typography.Paragraph>
      {rancherUi ? (
        <Typography.Paragraph style={{ marginBottom: 16 }}>
          <Typography.Link href={rancherUi} target="_blank" rel="noreferrer">
            打开 Rancher 控制台
          </Typography.Link>
          <Typography.Text type="secondary">（{rancherUi}）</Typography.Text>
        </Typography.Paragraph>
      ) : null}
      {detail ? (
        <Descriptions bordered size="small" column={1} style={{ maxWidth: 720 }}>
          <Descriptions.Item label="集群 ID">{detail.id}</Descriptions.Item>
          <Descriptions.Item label="名称">{detail.name}</Descriptions.Item>
          <Descriptions.Item label="状态">{detail.state || '—'}</Descriptions.Item>
          <Descriptions.Item label="Kubernetes">{detail.kubernetesVersion || '—'}</Descriptions.Item>
          <Descriptions.Item label="Provider">{detail.provider || '—'}</Descriptions.Item>
          <Descriptions.Item label="Agent 镜像">{detail.agentImage || '—'}</Descriptions.Item>
        </Descriptions>
      ) : (
        !loading && <Typography.Text type="secondary">暂无集群详情</Typography.Text>
      )}
    </PageDetailSection>
  );
};

export default ClusterToolsPanel;
