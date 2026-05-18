import React, { useMemo, useState } from 'react';
import { Button, Typography, Tooltip } from 'antd';
import { CloudUploadOutlined } from '@ant-design/icons';
import { useOutletContext } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import type { AdminLayoutOutletContext } from '../../../layouts/admin/adminLayoutOutletContext';
import PoolEdgeWizard from '../pools/modals/CloudWizardeasy';
import { hasPermissionForAction } from '../../../utils/accessMapping';
import {
  CLOUD_RESOURCE_POOLS_CREATE_WRITE,
  CLOUD_RESOURCE_POOLS_WRITE,
} from '../../../constants/cloudPermissions';

const HEADER_OFFSET_PX = 64;

/** 管理端工作台开荒页：与顶栏接入向导同一套 `PoolEdgeWizard` */
const AdminWelcomePage: React.FC = () => {
  const { user } = useAuth();
  const { reloadSummaryClouds } = useOutletContext<AdminLayoutOutletContext>();
  const [wizardOpen, setWizardOpen] = useState(false);

  const canWritePools = useMemo(() => {
    if (!user) return false;
    if (String(user.role || '').toLowerCase() === 'super_admin') return true;
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    return (
      hasPermissionForAction(perms, CLOUD_RESOURCE_POOLS_CREATE_WRITE) ||
      hasPermissionForAction(perms, CLOUD_RESOURCE_POOLS_WRITE) ||
      hasPermissionForAction(perms, 'clouds:write')
    );
  }, [user]);

  const handleWizardSuccess = () => {
    setWizardOpen(false);
    void reloadSummaryClouds?.();
  };

  return (
    <div
      style={{
        minHeight: `calc(100vh - ${HEADER_OFFSET_PX}px)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 24px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 880,
          padding: '48px 56px',
          boxSizing: 'border-box',
          transform: 'translateY(calc(-1 * min(10vh, 88px)))',
        }}
      >
        <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 12, textAlign: 'center' }}>
          开始使用
        </Typography.Title>
        <Typography.Paragraph
          type="secondary"
          style={{ marginBottom: 32, fontSize: 16, textAlign: 'center', maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' }}
        >
          接入首个资源池，解锁平台核心管理能力。
        </Typography.Paragraph>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Tooltip title={!canWritePools ? '当前账号暂无资源池接入权限' : undefined}>
            <Button
              type="primary"
              size="large"
              icon={<CloudUploadOutlined />}
              disabled={!canWritePools}
              onClick={() => setWizardOpen(true)}
              style={{ minWidth: 200, height: 48, fontSize: 16 }}
            >
              接入资源池
            </Button>
          </Tooltip>
        </div>
      </div>

      <PoolEdgeWizard
        visible={wizardOpen}
        onCancel={() => setWizardOpen(false)}
        onSuccess={handleWizardSuccess}
        forceRequired={false}
        editingCloud={null}
      />
    </div>
  );
};

export default AdminWelcomePage;
