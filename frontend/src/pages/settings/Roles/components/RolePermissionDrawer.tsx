import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Drawer,
  Empty,
  Flex,
  Input,
  Menu,
  message,
  Row,
  Segmented,
  Space,
  Tabs,
  Typography,
} from 'antd';
import type { DrawerProps } from 'antd';
import { permissionFeatureMatchesKeyword } from '../../../../utils/permissionUtils';
import { PLATFORM_LABELS } from '../../../../constants/navigation';
import type {
  RolePermVerbFilter,
  RolePermissionGroup,
  RolePermissionPlatform,
} from '../lib/rolePermissionTypes';

const { Text } = Typography;

type Props = {
  open: boolean;
  kw: string;
  permVerb: RolePermVerbFilter;
  grantSelectedIds: string[];
  permissionStructure: RolePermissionPlatform[];
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

function flattenGroupFeatures(group: RolePermissionGroup) {
  const out = [...(group.features || [])];
  for (const sg of group.subgroups || []) {
    out.push(...(sg.features || []));
  }
  if (group.tailFeatures?.length) {
    out.push(...group.tailFeatures);
  }
  return out;
}

type PermVerbFilter = RolePermVerbFilter;

function collectFeatureActionIds(feature: RolePermissionGroup['features'][number], permVerb: PermVerbFilter): string[] {
  const ids: string[] = [];
  if (feature.read && feature.readVisible && (permVerb === '全部' || permVerb === 'read')) {
    ids.push(feature.read);
  }
  if (feature.write && feature.writeVisible && (permVerb === '全部' || permVerb === 'write')) {
    ids.push(feature.write);
  }
  return ids;
}

function collectGroupActionIds(group: RolePermissionGroup, permVerb: PermVerbFilter): string[] {
  return flattenGroupFeatures(group).flatMap((f) => collectFeatureActionIds(f, permVerb));
}

function countGroupSelection(
  group: RolePermissionGroup,
  selectedSet: Set<string>,
  permVerb: PermVerbFilter,
): { selected: number; total: number } {
  const ids = collectGroupActionIds(group, permVerb);
  const selected = ids.filter((id) => selectedSet.has(id)).length;
  return { selected, total: ids.length };
}

function countPlatformSelection(
  platform: RolePermissionPlatform,
  selectedSet: Set<string>,
  permVerb: PermVerbFilter,
): { selected: number; total: number } {
  let selected = 0;
  let total = 0;
  for (const group of platform.groups) {
    const c = countGroupSelection(group, selectedSet, permVerb);
    selected += c.selected;
    total += c.total;
  }
  return { selected, total };
}

function PermCountLabel({ name, selected, total }: { name: string; selected: number; total: number }) {
  const active = selected > 0;
  return (
    <Flex justify="space-between" align="center" gap={4} style={{ width: '100%', minWidth: 0 }}>
      <Text ellipsis style={{ flex: 1, minWidth: 0 }}>
        {name}
      </Text>
      {total > 0 && (
        <Text
          type={active ? undefined : 'secondary'}
          strong={active}
          style={{
            flexShrink: 0,
            fontSize: 12,
            color: active ? 'var(--ant-color-primary)' : undefined,
          }}
        >
          {selected}/{total}
        </Text>
      )}
    </Flex>
  );
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

const tabsRootStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
};

type PlatformPermissionPanelProps = {
  platform: RolePermissionPlatform;
  isActive: boolean;
  selectedGroupKey: string;
  contentScrollRef: React.RefObject<HTMLDivElement | null>;
  grantSelectedIds: string[];
  permVerb: PermVerbFilter;
  onSelectGroup: (key: string) => void;
  renderGroupBody: (group: RolePermissionGroup) => React.ReactNode;
};

/** 单平台面板：左侧业务域 Menu + 右侧权限卡片（切换平台 Tab 时不卸载） */
const PlatformPermissionPanel: React.FC<PlatformPermissionPanelProps> = ({
  platform,
  isActive,
  selectedGroupKey,
  contentScrollRef,
  grantSelectedIds,
  permVerb,
  onSelectGroup,
  renderGroupBody,
}) => {
  const groups = platform.groups;
  const selectedSet = useMemo(() => new Set(grantSelectedIds), [grantSelectedIds]);
  if (groups.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无权限" />;
  }

  const selectedGroup = groups.find(
    (g) => panelKey(platform.platform, g.group) === selectedGroupKey,
  );

  return (
    <Flex gap={G} style={{ height: '100%', minHeight: 420 }}>
      <Card
        size="small"
        title="业务域"
        variant="borderless"
        style={{
          width: 220,
          flexShrink: 0,
          alignSelf: 'stretch',
          border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
          borderRadius: 8,
        }}
        styles={{
          header: { padding: G, fontSize: 14 },
          body: { padding: 0, maxHeight: '100%', overflow: 'auto', fontSize: 14 },
        }}
      >
        <Menu
          mode="inline"
          selectedKeys={selectedGroupKey ? [selectedGroupKey] : []}
          items={groups.map((g) => {
            const { selected, total } = countGroupSelection(g, selectedSet, permVerb);
            return {
              key: panelKey(platform.platform, g.group),
              label: (
                <PermCountLabel
                  name={g.group || '未分组'}
                  selected={selected}
                  total={total}
                />
              ),
            };
          })}
          onClick={({ key }) => onSelectGroup(String(key))}
          style={{ borderInlineEnd: 'none' }}
        />
      </Card>

      <div
        ref={(el) => {
          if (isActive && contentScrollRef) {
            (contentScrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
          }
        }}
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
        {selectedGroup ? (
          renderGroupBody(selectedGroup)
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择业务域" />
        )}
      </div>
    </Flex>
  );
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
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const [activePlatform, setActivePlatform] = useState<string>('');
  const [activeGroupByPlatform, setActiveGroupByPlatform] = useState<Record<string, string>>({});

  const selectedSet = useMemo(() => new Set(grantSelectedIds), [grantSelectedIds]);

  const platformKeys = useMemo(
    () => permissionStructure.map((p) => p.platform),
    [permissionStructure],
  );

  useEffect(() => {
    if (!open || platformKeys.length === 0) return;
    setActivePlatform((prev) => (prev && platformKeys.includes(prev) ? prev : platformKeys[0]));
  }, [open, platformKeys]);

  const resolveGroupKey = useCallback(
    (platform: string, groups: RolePermissionGroup[]) => {
      if (groups.length === 0) return '';
      const saved = activeGroupByPlatform[platform];
      if (saved && groups.some((g) => panelKey(platform, g.group) === saved)) {
        return saved;
      }
      return panelKey(platform, groups[0].group);
    },
    [activeGroupByPlatform],
  );

  const selectGroup = useCallback((platform: string, groupKey: string) => {
    setActiveGroupByPlatform((prev) => ({ ...prev, [platform]: groupKey }));
  }, []);

  useEffect(() => {
    if (!open || !kw.trim() || permissionStructure.length === 0) return;
    const needle = kw.trim();
    for (const platform of permissionStructure) {
      for (const group of platform.groups) {
        const hit = flattenGroupFeatures(group).find((f) =>
          permissionFeatureMatchesKeyword(f, needle),
        );
        if (!hit) continue;
        const gKey = panelKey(platform.platform, group.group);
        setActivePlatform(platform.platform);
        selectGroup(platform.platform, gKey);
        const id = requestAnimationFrame(() => {
          const root = contentScrollRef.current;
          if (!root) return;
          const cards = root.querySelectorAll('[data-perm-card="1"]');
          for (let i = 0; i < cards.length; i++) {
            const el = cards[i] as HTMLElement;
            const prefix = el.getAttribute('data-perm-prefix') || '';
            const titleAttr = el.getAttribute('data-perm-title') || '';
            const pathSuffix = el.getAttribute('data-perm-path') || '';
            if (
              permissionFeatureMatchesKeyword(
                { resourcePrefix: prefix, feature: titleAttr, pathSuffix },
                needle,
              )
            ) {
              el.scrollIntoView({ block: 'center', behavior: 'smooth' });
              break;
            }
          }
        });
        return () => cancelAnimationFrame(id);
      }
    }
  }, [kw, open, permissionStructure, selectGroup]);

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

  const renderFeatureCards = useCallback(
    (features: RolePermissionGroup['features'], opts?: { cardSpan?: number }) => (
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
            data-perm-path={feature.pathSuffix || ''}
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
                  {feature.resourcePrefix ||
                    Array.from(
                      new Set(
                        [
                          feature.readVisible ? feature.read : null,
                          feature.writeVisible ? feature.write : null,
                        ]
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
    ),
    [grantSelectedIds, onPermissionChange],
  );

  const renderGroupBody = useCallback((group: RolePermissionGroup) => {
    if (group.group === '多云管理' || group.group === '租户控制台') {
      return renderFeatureCards(group.features);
    }

    const subgroups = group.subgroups;
    const tailFeatures = group.tailFeatures;
    if (subgroups?.length) {
      return (
        <>
          {group.features?.length > 0 && (
            <>
              {renderFeatureCards(group.features)}
              <Divider style={{ margin: `${G}px 0` }} />
            </>
          )}
          {subgroups.map((sg, idx) => (
            <div key={sg.label}>
              <Text type="secondary" style={{ display: 'block', marginBottom: G }}>
                {sg.label}
              </Text>
              {renderFeatureCards(sg.features)}
              {idx < subgroups.length - 1 && <Divider style={{ margin: `${G}px 0` }} />}
            </div>
          ))}
          {tailFeatures && tailFeatures.length > 0 && (
            <>
              <Divider style={{ margin: `${G}px 0` }} />
              {renderFeatureCards(tailFeatures)}
            </>
          )}
        </>
      );
    }

    return renderFeatureCards(group.features);
  }, [renderFeatureCards]);

  const tabItems = useMemo(
    () =>
      permissionStructure.map((platform) => {
        const platformLabel =
          (PLATFORM_LABELS as Record<string, string>)[platform.platform] || platform.platform;
        const { selected, total } = countPlatformSelection(platform, selectedSet, permVerb);
        return {
          key: platform.platform,
          label: (
            <PermCountLabel name={platformLabel} selected={selected} total={total} />
          ),
          forceRender: true,
          children: (
            <PlatformPermissionPanel
              platform={platform}
              isActive={activePlatform === platform.platform}
              selectedGroupKey={resolveGroupKey(platform.platform, platform.groups)}
              contentScrollRef={contentScrollRef}
              grantSelectedIds={grantSelectedIds}
              permVerb={permVerb}
              onSelectGroup={(key) => selectGroup(platform.platform, key)}
              renderGroupBody={renderGroupBody}
            />
          ),
        };
      }),
    [
      permissionStructure,
      activePlatform,
      grantSelectedIds,
      selectedSet,
      permVerb,
      resolveGroupKey,
      selectGroup,
      renderGroupBody,
    ],
  );

  return (
    <Drawer
      title="配置权限"
      placement="right"
      width={1280}
      open={open}
      onClose={onClose}
      destroyOnHidden={false}
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
          <Flex align="center" gap={G} wrap="wrap" style={{ flexShrink: 0 }}>
            <Text type="secondary" style={{ fontSize: 14, lineHeight: '22px' }}>
              已选择 <Text strong style={{ color: 'var(--ant-color-primary)' }}>{grantSelectedIds.length}</Text> 项
            </Text>
            <Button
              type="link"
              onClick={copyCurrentPermissions}
              style={{ padding: 0, height: 'auto', fontSize: 14, lineHeight: '22px' }}
            >
              复制权限
            </Button>
            <Button
              type="link"
              onClick={onClearSelected}
              style={{ padding: 0, height: 'auto', fontSize: 14, lineHeight: '22px' }}
            >
              清空选择
            </Button>
          </Flex>
        </Flex>

        {permissionStructure.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无权限数据" />
        ) : (
          <Tabs
            className="role-perm-drawer-tabs"
            activeKey={activePlatform || platformKeys[0]}
            onChange={setActivePlatform}
            destroyInactiveTabPane={false}
            items={tabItems}
            style={tabsRootStyle}
          />
        )}
      </Flex>
    </Drawer>
  );
};

export default RolePermissionDrawer;
