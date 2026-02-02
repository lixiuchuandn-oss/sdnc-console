import React from 'react';
import { Drawer, Tabs, Input } from 'antd';
import LinedTextArea from '../../../../components/LinedTextArea';

export interface HarvesterResourceDrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  record: any;     // 列表行数据，用于显示"元数据"
  resource: any;   // 详情数据，用于显示"完整JSON"和"详情"
  loading?: boolean;
  activeTab?: string;
  onTabChange?: (key: string) => void;
  renderDetail?: (resource: any) => React.ReactNode;
}

const HarvesterResourceDrawer: React.FC<HarvesterResourceDrawerProps> = ({
  open,
  onClose,
  title = '数据查看',
  record,
  resource,
  loading = false,
  activeTab = 'detail',
  onTabChange,
  renderDetail,
}) => {
  return (
    <Drawer
      title={title}
      open={open}
      onClose={onClose}
      placement="right"
      width="50%"
      styles={{ body: { padding: 0, height: '100%', overflow: 'hidden' } }}
    >
      <style>{`
        .full-height-drawer-tabs { height: 100%; display: flex; flex-direction: column; }
        .full-height-drawer-tabs .ant-tabs-nav { margin-bottom: 0; padding: 0 16px; }
        .full-height-drawer-tabs .ant-tabs-content-holder { flex: 1; height: 100%; overflow: hidden; }
        .full-height-drawer-tabs .ant-tabs-content { height: 100%; }
        .full-height-drawer-tabs .ant-tabs-tabpane { height: 100%; }
        .full-height-drawer-tabs .ant-tabs-tabpane-active { display: flex; flex-direction: column; }
      `}</style>
      <Tabs
        className="full-height-drawer-tabs"
        activeKey={activeTab}
        onChange={onTabChange}
        items={[
          {
            key: 'detail',
            label: '详情',
            children: (
              <div style={{ height: '100%', overflow: 'auto', padding: '16px' }}>
                {loading ? (
                  <div style={{ textAlign: 'center', marginTop: 100 }}>加载中...</div>
                ) : (
                  renderDetail ? renderDetail(resource) : (
                    <div style={{ color: '#999', textAlign: 'center', marginTop: 50 }}>暂无详情展示内容</div>
                  )
                )}
              </div>
            ),
          },
          {
            key: 'json',
            label: '完整JSON',
            children: (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                {loading ? (
                  <div style={{ padding: 16 }}>加载中...</div>
                ) : (
                  <LinedTextArea
                    readOnly
                    value={resource ? JSON.stringify(resource, null, 2) : (resource === null ? '加载中或无数据...' : '')}
                    className="metadata-viewer"
                    style={{ flex: 1, border: 'none', borderRadius: 0 }}
                  />
                )}
              </div>
            ),
          },
          {
            key: 'metadata',
            label: '列表数据',
            children: (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <LinedTextArea
                  readOnly
                  value={record ? JSON.stringify(record, null, 2) : ''}
                  className="metadata-viewer"
                  style={{ flex: 1, border: 'none', borderRadius: 0 }}
                />
              </div>
            ),
          },
        ]}
      />
    </Drawer>
  );
};

export default HarvesterResourceDrawer;
