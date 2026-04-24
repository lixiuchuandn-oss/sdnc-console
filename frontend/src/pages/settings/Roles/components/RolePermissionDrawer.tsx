import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Anchor,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Divider,
  Empty,
  Form,
  Input,
  Row,
  Select,
  Space,
  Typography,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import StdSideDrawer from '../../../../components/StdSideDrawer';
import type { RBACRole } from '../types';
import { groupResourceConsoleChildFeatures } from '../../../../utils/permissionUtils';
import { PLATFORM_LABELS } from '../../../../constants/navigation';

const { Text, Title } = Typography;

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

function panelKey(platform: string, group: string) {
  return `${platform}::${group || '未分组'}`;
}

function sectionDomId(platform: string, group: string) {
  const g = String(group || '未分组').replace(/\s+/g, '');
  return `perm-sec-${platform}-${g}`;
}

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [openCollapseKeys, setOpenCollapseKeys] = useState<string[]>([]);

  const panelKeys = useMemo(
    () =>
      permissionStructure.flatMap((p) => p.groups.map((g: any) => panelKey(p.platform, g.group))),
    [permissionStructure],
  );

  const structureSig = panelKeys.join('|');

  useLayoutEffect(() => {
    if (!open) return;
    setOpenCollapseKeys(panelKeys);
  }, [open, structureSig]);

  const anchorItems = useMemo(() => {
    return permissionStructure.map((p) => ({
      key: p.platform,
      href: `#perm-plat-${p.platform}`,
      title: (PLATFORM_LABELS as Record<string, string>)[p.platform] || p.platform,
      children: p.groups.map((g: any) => ({
        key: panelKey(p.platform, g.group),
        href: `#${sectionDomId(p.platform, g.group)}`,
        title: g.group || '未分组',
      })),
    }));
  }, [permissionStructure]);

  useEffect(() => {
    if (!open || !kw.trim()) return;
    const id = requestAnimationFrame(() => {
      const root = scrollRef.current;
      if (!root) return;
      const needle = kw.trim().toLowerCase();
      const cards = root.querySelectorAll('[data-perm-card="1"]');
      for (let i = 0; i < cards.length; i++) {
        const el = cards[i] as HTMLElement;
        const prefix = (el.getAttribute('data-perm-prefix') || '').toLowerCase();
        const titleAttr = (el.getAttribute('data-perm-title') || '').toLowerCase();
        if (prefix.includes(needle) || titleAttr.includes(needle)) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          break;
        }
      }
    });
    return () => cancelAnimationFrame(id);
  }, [kw, open, permissionStructure]);

  const renderFeatureCards = (features: any[], opts?: { cardSpan?: number }) => (
    <Row gutter={[16, 12]}>
      {features.map((feature) => (
        <Col span={opts?.cardSpan ?? 8} key={`${feature.resourcePrefix || feature.feature}`}>
          <Card
            size="small"
            data-perm-card="1"
            data-perm-prefix={feature.resourcePrefix || ''}
            data-perm-title={feature.feature || ''}
          >
            <div
              style={{
                display: 'flex',
                width: '100%',
                gap: 12,
                alignItems: 'flex-start',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text ellipsis style={{ display: 'block' }}>
                  {feature.feature}
                </Text>
                <Text
                  type="secondary"
                  style={{ display: 'block', marginTop: 4, fontSize: 12, lineHeight: 1.4, wordBreak: 'break-all' }}
                >
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

  const renderGroupBody = (group: any) => {
    if (group.group === '平台入口能力') {
      return renderFeatureCards(group.features);
    }

    const parentFeatures = group.features.filter((feature: any) => feature.isResourceParent);
    const childFeatures = group.features.filter((feature: any) => !feature.isResourceParent);
    const isResourceConsoleGroup = group.group === '资源池管理';
    const hasSplit = isResourceConsoleGroup && (parentFeatures.length > 0 || childFeatures.length > 0);

    if (!hasSplit) return renderFeatureCards(group.features);

    return (
      <>
        {parentFeatures.length > 0 && (
          <>
            {renderFeatureCards(parentFeatures, { cardSpan: 24 })}
            <Divider style={{ margin: '16px 0' }} />
          </>
        )}
        {groupResourceConsoleChildFeatures(childFeatures.length > 0 ? childFeatures : group.features).map(
          (childGroup, idx, arr) => (
            <div key={childGroup.label}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                {childGroup.label}
              </Text>
              {renderFeatureCards(childGroup.items)}
              {idx < arr.length - 1 && <Divider style={{ margin: '16px 0' }} />}
            </div>
          ),
        )}
      </>
    );
  };

  return (
    <StdSideDrawer
      title={`配置权限 - ${target?.name}`}
      open={open}
      onClose={onClose}
      onOk={onSave}
      width={1280}
      styles={{ body: { display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 24 } }}
    >
      <div className="page-toolbar" style={{ marginBottom: 10 }}>
        <Form
          className="toolbar-container"
          layout="vertical"
          style={{ display: 'flex', alignItems: 'flex-end', rowGap: 12, columnGap: 12 }}
        >
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
              placeholder="搜索名称或权限 ID（如 clouds.console）"
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

      <div
        style={{
          flex: 1,
          display: 'flex',
          minHeight: 0,
          gap: 16,
        }}
      >
        <div
          ref={scrollRef}
          className="role-perm-drawer-scroll"
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'auto',
            padding: 12,
            border: '1px solid var(--ant-color-border, #d9d9d9)',
            borderRadius: 8,
            background: 'var(--ant-color-bg-container, #fff)',
          }}
        >
          {permissionStructure.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无权限数据" />
          ) : (
            permissionStructure.map((platform, platformIdx) => (
              <div
                key={platform.platform}
                style={{ marginBottom: platformIdx < permissionStructure.length - 1 ? 28 : 0 }}
              >
                <div id={`perm-plat-${platform.platform}`} style={{ scrollMarginTop: 8 }}>
                  <Title level={5} style={{ margin: '0 0 12px' }}>
                    {(PLATFORM_LABELS as Record<string, string>)[platform.platform] || platform.platform}
                    <Text type="secondary" style={{ marginLeft: 8, fontSize: 13, fontWeight: 'normal' }}>
                      {platform.platform}
                    </Text>
                  </Title>
                </div>
                <Collapse
                  bordered={false}
                  activeKey={openCollapseKeys}
                  onChange={(keys) => setOpenCollapseKeys(Array.isArray(keys) ? keys : [keys])}
                  style={{ background: 'transparent', boxShadow: 'none' }}
                  className="role-perm-drawer-collapse"
                  items={platform.groups.map((group: any, groupIdx: number) => ({
                    key: panelKey(platform.platform, group.group),
                    label: (
                      <span id={sectionDomId(platform.platform, group.group)} style={{ scrollMarginTop: 48 }}>
                        <Text strong>{group.group}</Text>
                      </span>
                    ),
                    style: { marginBottom: groupIdx < platform.groups.length - 1 ? 8 : 0 },
                    children: renderGroupBody(group),
                  }))}
                />
              </div>
            ))
          )}
        </div>

        <div
          className="role-perm-drawer-scroll"
          style={{
            width: 220,
            flexShrink: 0,
            padding: 12,
            alignSelf: 'stretch',
            overflow: 'auto',
          }}
        >
          {permissionStructure.length === 0 ? null : (
            <Anchor
              affix={false}
              getContainer={() => scrollRef.current || window}
              items={anchorItems}
            />
          )}
        </div>
      </div>
    </StdSideDrawer>
  );
};

export default RolePermissionDrawer;