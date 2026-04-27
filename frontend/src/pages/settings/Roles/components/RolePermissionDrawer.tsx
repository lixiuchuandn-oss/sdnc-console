import React, { useEffect, useMemo, useRef, startTransition, useState } from 'react';
import {
  Anchor,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Divider,
  Drawer,
  Empty,
  Flex,
  Input,
  message,
  Row,
  Segmented,
  Space,
  Typography,
} from 'antd';
import type { DrawerProps } from 'antd';
import { groupResourceConsoleChildFeatures } from '../../../../utils/permissionUtils';
import { PLATFORM_LABELS } from '../../../../constants/navigation';

const { Text, Title } = Typography;

type Props = {
  open: boolean;
  kw: string;
  permVerb: '全部' | 'read' | 'write';
  grantSelectedIds: string[];
  permissionStructure: any[];
  confirmLoading?: boolean;
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

/** 抽屉内统一间距（px） */
const G = 10;

const drawerStyles: DrawerProps['styles'] = {
  body: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    padding: G,
    fontSize: 14,
  },
  footer: {
    marginTop: 0,
    padding: G,
  },
};

const RolePermissionDrawer: React.FC<Props> = ({
  open,
  kw,
  permVerb,
  grantSelectedIds,
  permissionStructure,
  confirmLoading = false,
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

  useEffect(() => {
    if (!open) return;
    const keys = panelKeys;
    startTransition(() => {
      setOpenCollapseKeys(keys);
    });
  }, [open, structureSig, panelKeys]);

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

  const copyCurrentPermissions = async () => {
    const sorted = [...grantSelectedIds].sort();
    const text = JSON.stringify(sorted, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      message.success(sorted.length ? `已复制 ${sorted.length} 条权限` : '已复制（当前未勾选任何权限）');
    } catch {
      message.error('复制失败，请检查浏览器剪贴板权限');
    }
  };

  const renderFeatureCards = (features: any[], opts?: { cardSpan?: number }) => (
    <Row gutter={[G, G]}>
      {features.map((feature) => (
        <Col span={opts?.cardSpan ?? 8} key={`${feature.resourcePrefix || feature.feature}`}>
          <Card
            size="small"
            variant="borderless"
            styles={{ body: { padding: G, fontSize: 14 } }}
            style={{
              background: 'var(--ant-color-fill-alter, rgba(0,0,0,.02))',
              borderRadius: 8,
            }}
            data-perm-card="1"
            data-perm-prefix={feature.resourcePrefix || ''}
            data-perm-title={feature.feature || ''}
          >
            <Flex gap={G} align="flex-start" justify="space-between" wrap="wrap">
              <Flex vertical gap={G / 2} style={{ flex: 1, minWidth: 0 }}>
                <Text ellipsis style={{ display: 'block' }}>
                  {feature.feature}
                </Text>
                <Text
                  type="secondary"
                  style={{ display: 'block', fontSize: 14, lineHeight: 1.4, wordBreak: 'break-all' }}
                >
                  {Array.from(
                    new Set(
                      [feature.readVisible ? feature.read : null, feature.writeVisible ? feature.write : null]
                        .filter(Boolean)
                        .map((id) => String(id).split(':')[0]),
                    ),
                  ).join(' / ')}
                </Text>
              </Flex>
              <Space size={G} style={{ flexShrink: 0 }}>
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
            </Flex>
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
            <Divider style={{ margin: `${G}px 0` }} />
          </>
        )}
        {groupResourceConsoleChildFeatures(childFeatures.length > 0 ? childFeatures : group.features).map(
          (childGroup, idx, arr) => (
            <div key={childGroup.label}>
              <Text type="secondary" style={{ display: 'block', marginBottom: G }}>
                {childGroup.label}
              </Text>
              {renderFeatureCards(childGroup.items)}
              {idx < arr.length - 1 && <Divider style={{ margin: `${G}px 0` }} />}
            </div>
          ),
        )}
      </>
    );
  };

  return (
    <Drawer
      title="配置权限"
      placement="right"
      width={1280}
      open={open}
      onClose={onClose}
      destroyOnHidden
      maskClosable
      styles={drawerStyles}
      footer={
        <Flex justify="flex-end" gap={G}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={onSave} loading={confirmLoading}>
            保存
          </Button>
        </Flex>
      }
    >
      <Flex vertical gap={G} style={{ flex: 1, minHeight: 0 }}>
        <Flex wrap="wrap" gap={G} align="center" justify="space-between">
          <Flex wrap="wrap" gap={G} align="center" flex={1} style={{ minWidth: 280 }}>
            <Segmented
              value={permVerb}
              onChange={(v) => onPermVerbChange(v as '全部' | 'read' | 'write')}
              options={[
                { label: '全部', value: '全部' },
                { label: '只读', value: 'read' },
                { label: '读写', value: 'write' },
              ]}
            />
            <Input.Search
              allowClear
              placeholder="搜索名称或权限 ID（如 clouds.console）"
              value={kw}
              onChange={(e) => onKwChange(e.target.value)}
              style={{ flex: 1, minWidth: 200, maxWidth: 560 }}
            />
          </Flex>
          <Space size={G}>
            <Text type="secondary">
              已选择 <Text strong style={{ color: 'var(--ant-color-primary)' }}>{grantSelectedIds.length}</Text> 项
            </Text>
            <Button type="link" onClick={copyCurrentPermissions} style={{ fontSize: 14 }}>
              复制权限
            </Button>
            <Button type="link" onClick={onClearSelected} style={{ fontSize: 14 }}>
              清空选择
            </Button>
          </Space>
        </Flex>

        <Flex gap={G} style={{ flex: 1, minHeight: 0 }}>
          {permissionStructure.length > 0 ? (
            <Card
              className="role-perm-drawer-toc"
              size="small"
              title="目录"
              variant="borderless"
              style={{
                width: 220,
                flexShrink: 0,
                alignSelf: 'stretch',
                border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
                borderRadius: 8,
                boxShadow: 'none',
              }}
              styles={{
                header: { padding: G, fontSize: 14 },
                body: { padding: G, maxHeight: '100%', overflow: 'auto', fontSize: 14 },
              }}
            >
              <Anchor
                affix={false}
                getContainer={() => scrollRef.current || window}
                items={anchorItems}
              />
            </Card>
          ) : null}

          <div
            ref={scrollRef}
            className="role-perm-drawer-scroll"
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'auto',
              padding: G,
              border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
              borderRadius: 8,
              background: 'var(--ant-color-bg-container, #fff)',
              fontSize: 14,
            }}
          >
            {permissionStructure.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无权限数据" />
            ) : (
              permissionStructure.map((platform, platformIdx) => (
                <div
                  key={platform.platform}
                  style={{ marginBottom: platformIdx < permissionStructure.length - 1 ? G : 0 }}
                >
                  <div id={`perm-plat-${platform.platform}`} style={{ scrollMarginTop: G }}>
                    <Title level={5} style={{ margin: `0 0 ${G}px`, fontSize: 14 }}>
                      {(PLATFORM_LABELS as Record<string, string>)[platform.platform] || platform.platform}
                      <Text type="secondary" style={{ marginLeft: G / 2, fontSize: 14, fontWeight: 'normal' }}>
                        {platform.platform}
                      </Text>
                    </Title>
                  </div>
                  <Collapse
                    bordered={false}
                    expandIconPosition="end"
                    activeKey={openCollapseKeys}
                    onChange={(keys) => setOpenCollapseKeys(Array.isArray(keys) ? keys : [keys])}
                    style={{ background: 'transparent' }}
                    className="role-perm-drawer-collapse"
                    items={platform.groups.map((group: any, groupIdx: number) => ({
                      key: panelKey(platform.platform, group.group),
                      label: (
                        <span id={sectionDomId(platform.platform, group.group)} style={{ scrollMarginTop: G }}>
                          <Text strong>{group.group}</Text>
                        </span>
                      ),
                      style: { marginBottom: groupIdx < platform.groups.length - 1 ? G : 0 },
                      styles: {
                        header: {
                          padding: G,
                          borderRadius: 8,
                          background: 'var(--ant-color-fill-alter, rgba(0,0,0,.02))',
                          fontSize: 14,
                        },
                        body: { padding: G, fontSize: 14 },
                      },
                      children: renderGroupBody(group),
                    }))}
                  />
                </div>
              ))
            )}
          </div>
        </Flex>
      </Flex>
    </Drawer>
  );
};

export default RolePermissionDrawer;
