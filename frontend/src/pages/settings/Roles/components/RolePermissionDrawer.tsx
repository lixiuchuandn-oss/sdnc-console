import React from 'react';
import { Button, Card, Checkbox, Col, Empty, Form, Input, Row, Select, Space, Typography, Divider } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import StdSideDrawer from '../../../../components/StdSideDrawer';
import type { RBACRole } from '../types';
import { groupResourceConsoleChildFeatures } from '../../../../utils/permissionUtils';

const { Text } = Typography;

type Props = {
  open: boolean;
  target: RBACRole | null;
  kw: string;
  permVerb: '全部' | 'read' | 'write';
  grantSelectedIds: string[];
  permissionStructure: any[];
  onKwChange: (v: string) => void;
  onPermVerbChange: (v: '全部' | 'read' | 'write') => void;
  onClearSelected: () => void;
  onPermissionChange: (action: string, checked: boolean) => void;
  onClose: () => void;
  onSave: () => void;
};

const RolePermissionDrawer: React.FC<Props> = ({
  open,
  target,
  kw,
  permVerb,
  grantSelectedIds,
  permissionStructure,
  onKwChange,
  onPermVerbChange,
  onClearSelected,
  onPermissionChange,
  onClose,
  onSave,
}) => {
  return (
    <StdSideDrawer
      title={`配置权限 - ${target?.name}`}
      open={open}
      onClose={onClose}
      onOk={onSave}
      width={1200}
      styles={{ body: { display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 24 } }}
    >
      <div className="page-toolbar">
        <Form className="toolbar-container" layout="vertical" style={{ display: 'flex', alignItems: 'flex-end', rowGap: 12, columnGap: 12 }}>
          <Form.Item style={{ width: 160, marginBottom: 0 }}>
            <Select
              value={permVerb}
              onChange={(v: any) => onPermVerbChange(v)}
              options={[
                { value: '全部', label: '全部' },
                { value: 'read', label: '只读' },
                { value: 'write', label: '读写' },
              ]}
            />
          </Form.Item>
          <Form.Item style={{ flex: 1, marginBottom: 0 }}>
            <Input
              allowClear
              placeholder="搜索功能名称"
              className="toolbar-search"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={kw}
              onChange={(e) => onKwChange(e.target.value)}
            />
          </Form.Item>
        </Form>
        <div className="toolbar-actions" style={{ display: 'flex', alignItems: 'center' }}>
          <Space>
            <Text>
              已选择 <Text strong style={{ color: '#1890ff' }}>{grantSelectedIds.length}</Text> 个权限
            </Text>
            <Button type="link" size="small" onClick={onClearSelected}>
              清空选择
            </Button>
          </Space>
        </div>
      </div>

      <Card
        variant="borderless"
        style={{
          flex: 1,
          overflow: 'auto',

        }}
        styles={{ body: { padding: '0 10px 0 0' } }}
      >
        {permissionStructure.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无权限数据" />
        ) : (
          permissionStructure.map((platform, platformIdx) => (
            <div key={platform.platform} style={{ marginBottom: platformIdx < permissionStructure.length - 1 ? 32 : 0 }}>
              {platform.groups.map((group: any, groupIdx: number) => (
                <div key={group.group} style={{ marginBottom: groupIdx < platform.groups.length - 1 ? 24 : 0 }}>
                  <Text strong style={{ display: 'block', marginBottom: 12, marginTop: groupIdx > 0 ? 16 : 0 }}>
                    {group.group}
                  </Text>

                  {(() => {
                    const parentFeatures = group.features.filter((feature: any) => feature.isResourceParent);
                    const childFeatures = group.features.filter((feature: any) => !feature.isResourceParent);
                    const isResourceConsoleGroup = group.group === '资源池管理';
                    const hasSplit = isResourceConsoleGroup && (parentFeatures.length > 0 || childFeatures.length > 0);

                    const renderFeatureCards = (features: any[], opts?: { cardSpan?: number }) => (
                      <Row gutter={[16, 12]}>
                        {features.map((feature) => (
                          <Col span={opts?.cardSpan ?? 8} key={`${feature.resourcePrefix || feature.feature}`}>
                            <Card size="small">
                              <div style={{ display: 'flex', width: '100%', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <Text ellipsis style={{ display: 'block' }}>
                                    {feature.feature}
                                  </Text>
                                  <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12, lineHeight: 1.4, wordBreak: 'break-all' }}>
                                    {Array.from(
                                      new Set(
                                        [feature.readVisible ? feature.read : null, feature.writeVisible ? feature.write : null]
                                          .filter(Boolean)
                                          .map((id) => String(id).split(':')[0]),
                                      ),
                                    ).join(' / ')}
                                  </Text>
                                </div>
                                <Space style={{ flexShrink: 0 }}>
                                  {feature.read && feature.readVisible && (
                                    <Checkbox
                                      checked={grantSelectedIds.includes(feature.read)}
                                      onChange={(e) => onPermissionChange(feature.read!, e.target.checked)}
                                    >
                                      只读
                                    </Checkbox>
                                  )}
                                  {feature.write && feature.writeVisible && (
                                    <Checkbox
                                      checked={grantSelectedIds.includes(feature.write)}
                                      onChange={(e) => onPermissionChange(feature.write!, e.target.checked)}
                                    >
                                      读写
                                    </Checkbox>
                                  )}
                                </Space>
                              </div>
                            </Card>
                          </Col>
                        ))}
                      </Row>
                    );

                    if (!hasSplit) return renderFeatureCards(group.features);

                    return (
                      <>
                        {parentFeatures.length > 0 && (
                          <>
                            {renderFeatureCards(parentFeatures, { cardSpan: 24 })}
                            <Divider style={{ margin: '16px 0' }} />
                          </>
                        )}
                        {groupResourceConsoleChildFeatures(childFeatures.length > 0 ? childFeatures : group.features).map((childGroup, idx, arr) => (
                          <div key={childGroup.label}>
                            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                              {childGroup.label}
                            </Text>
                            {renderFeatureCards(childGroup.items)}
                            {idx < arr.length - 1 && <Divider style={{ margin: '16px 0' }} />}
                          </div>
                        ))}
                      </>
                    );
                  })()}

                  {groupIdx < platform.groups.length - 1 && <Divider style={{ margin: '16px 0' }} />}
                </div>
              ))}
              {platformIdx < permissionStructure.length - 1 && <Divider style={{ margin: '24px 0' }} />}
            </div>
          ))
        )}
      </Card>
    </StdSideDrawer>
  );
};

export default RolePermissionDrawer;
