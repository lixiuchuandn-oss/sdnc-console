import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Space, Upload, App } from 'antd';
import { CloudUploadOutlined, ReloadOutlined, TagsOutlined } from '@ant-design/icons';
import PageContainer from '../../components/PageContainer';
import { useAuth } from '../../contexts/AuthContext';
import { hasPermissionForAction } from '../../utils/accessMapping';
import {
  applyOfflineUpgradeBundle,
  getOfflineUpgradeStatus,
  type OfflineUpgradeStatusDto,
} from '../../services/systemApi';

const OfflineUpgradeSettings: React.FC = () => {
  const { message, modal } = App.useApp();
  const { user } = useAuth();
  const perms = user?.permissions || [];
  const canRead = user?.role === 'super_admin' || hasPermissionForAction(perms, 'system.upgrade:read');
  const canWrite = user?.role === 'super_admin' || hasPermissionForAction(perms, 'system.upgrade:write');

  const [status, setStatus] = useState<OfflineUpgradeStatusDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [bundle, setBundle] = useState<File | null>(null);

  const load = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    try {
      const s = await getOfflineUpgradeStatus();
      setStatus(s);
    } catch (e: any) {
      message.error(e?.message || '加载状态失败');
    } finally {
      setLoading(false);
    }
  }, [canRead, message]);

  useEffect(() => {
    void load();
  }, [load]);

  const beforeUpload = (file: File) => {
    if (!canWrite) {
      message.warning('无上传与应用权限');
      return Upload.LIST_IGNORE;
    }
    const ok = file.name.toLowerCase().endsWith('.zip');
    if (!ok) {
      message.error('仅支持 .zip 离线包');
      return Upload.LIST_IGNORE;
    }
    setBundle(file);
    return false;
  };

  const handleApply = async () => {
    const raw = bundle;
    if (!raw) {
      message.warning('请先选择 zip 文件');
      return;
    }
    modal.confirm({
      title: '确认应用离线升级包？',
      content:
        '请确认文件来自可信渠道并已做好备份。应用不兼容或错误的升级包可能导致系统异常，建议在维护窗口或业务低峰期操作。',
      okText: '确认应用',
      cancelText: '取消',
      onOk: async () => {
        setUploading(true);
        try {
          const r = await applyOfflineUpgradeBundle(raw);
          setBundle(null);
          message.success(r.message || '已应用');
          await load();
        } catch (e: any) {
          message.error(e?.message || '应用失败');
        } finally {
          setUploading(false);
        }
      },
    });
  };

  if (!canRead) {
    return (
      <PageContainer asCard={false} titleLevel={3}>
        <Alert type="warning" showIcon message="无权访问此页面" />
      </PageContainer>
    );
  }

  return (
    <PageContainer asCard={false} titleLevel={3}>
      <style>{`
        .offline-upgrade-settings-cards > .ant-card {
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Alert
          type="info"
          showIcon
          message="升级前请知悉"
          description="请仅使用本单位或产品方提供的正式离线升级包，勿使用来源不明的文件。建议在维护窗口或业务低峰期操作；应用成功后后台将自动重启，请稍候刷新浏览器（Ctrl+F5）。"
        />

        <div className="offline-upgrade-settings-cards" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Card
            loading={loading}
            title={
              <span>
                <TagsOutlined style={{ marginRight: 8 }} />
                当前运行状态
              </span>
            }
            extra={
              <Button type="default" icon={<ReloadOutlined />} onClick={() => void load()}>
                刷新
              </Button>
            }
          >
            <Descriptions column={1} size="small" bordered style={{ maxWidth: 720 }}>
              <Descriptions.Item label="当前软件版本">{status?.runtimeVersion ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="最近一次离线升级">
                {status?.lastApplied
                  ? (() => {
                      const t = new Date(status.lastApplied.at).toLocaleString('zh-CN', { hour12: false });
                      const ver =
                        status.lastApplied.manifestVersion && String(status.lastApplied.manifestVersion).trim()
                          ? `包内标注版本：${status.lastApplied.manifestVersion}`
                          : '';
                      const parts: string[] = [];
                      if (status.lastApplied.appliedPublic) parts.push('管理界面');
                      if (status.lastApplied.appliedServer) parts.push('后台服务');
                      const scope = parts.length ? `已更新：${parts.join('、')}` : '已记录';
                      return [t, ver, scope].filter(Boolean).join('；');
                    })()
                  : '暂无记录'}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {canWrite ? (
            <Card
              title={
                <span>
                  <CloudUploadOutlined style={{ marginRight: 8 }} />
                  上传与应用
                </span>
              }
              style={{ marginBottom: 24 }}
            >
              <div style={{ maxWidth: 480 }}>
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <Upload
                    beforeUpload={beforeUpload}
                    fileList={
                      bundle ? [{ uid: '-1', name: bundle.name, status: 'done' as const }] : []
                    }
                    maxCount={1}
                    onRemove={() => setBundle(null)}
                  >
                    <Button icon={<CloudUploadOutlined />}>选择升级包（zip）</Button>
                  </Upload>
                  <div>
                    <Button type="primary" loading={uploading} disabled={!bundle} onClick={() => void handleApply()}>
                      应用离线包
                    </Button>
                  </div>
                </Space>
              </div>
            </Card>
          ) : (
            <Alert type="warning" showIcon message="当前账号仅有查看权限，无法上传应用离线包。" />
          )}
        </div>
      </div>
    </PageContainer>
  );
};

export default OfflineUpgradeSettings;
