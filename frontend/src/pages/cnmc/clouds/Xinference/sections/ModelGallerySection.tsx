/**
 * Xinference 资源池 · 模型广场（浏览注册表并启动）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Col,
  Empty,
  Flex,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Tabs,
  Typography,
} from 'antd';
import { ReloadOutlined, SearchOutlined, ShopOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageDetailSection from '../../../../../components/PageDetailSection';
import { xinferencePoolPathForTab } from '../../../../../layouts/admin/xinference/xinferencePoolSidebar';
import LaunchModelDrawer from '../components/LaunchModelDrawer';
import ModelRegistrationCard from '../components/ModelRegistrationCard';
import {
  DEFAULT_GALLERY_FILTER,
  cacheSegmentOptions,
  countGalleryFilterDimensions,
  filterGalleryRegistrations,
  galleryFilterEmptyDescription,
  hasActiveGalleryFilter,
  runtimeSegmentOptions,
  type GalleryFilterState,
} from '../lib/galleryFilters';
import { cachedVersionCountForModel, modelNameHasAnyCache } from '../lib/modelCacheUtils';
import {
  XINFERENCE_GALLERY_MODEL_TYPES,
  ABILITY_LABELS,
  collectAbilityOptions,
  modelTypeLabel,
  type XinferenceGalleryModelType,
} from '../lib/xinferenceModelRegistry';
import {
  fetchXinferenceCachedModels,
  fetchXinferenceModelRegistrationDetail,
  fetchXinferenceModelRegistrations,
  fetchXinferenceRunningModels,
  type XinferenceModelRegistration,
} from '../../../../../services/xinferenceApi';

type Props = {
  poolId: string;
};

const ModelGallerySection: React.FC<Props> = ({ poolId }) => {
  const navigate = useNavigate();
  const [modelType, setModelType] = useState<XinferenceGalleryModelType>('LLM');
  const [gallery, setGallery] = useState<XinferenceModelRegistration[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryEnriching, setGalleryEnriching] = useState(false);
  const [galleryErr, setGalleryErr] = useState<string | null>(null);
  const [runningNames, setRunningNames] = useState<Set<string>>(new Set());
  const [cachedVersions, setCachedVersions] = useState<string[]>([]);
  const [cacheLoadFailed, setCacheLoadFailed] = useState(false);
  const [filter, setFilter] = useState<GalleryFilterState>(DEFAULT_GALLERY_FILTER);

  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchTarget, setLaunchTarget] = useState<XinferenceModelRegistration | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailJson, setDetailJson] = useState<string>('');

  const loadRunningNames = useCallback(async () => {
    if (!poolId) return;
    try {
      const list = await fetchXinferenceRunningModels(poolId, { skipCache: true });
      setRunningNames(new Set(list.map((m) => m.modelName).filter(Boolean)));
    } catch {
      setRunningNames(new Set());
    }
  }, [poolId]);

  const loadCacheList = useCallback(async () => {
    if (!poolId) return;
    try {
      const list = await fetchXinferenceCachedModels(poolId, undefined, { skipCache: true });
      setCachedVersions(list);
      setCacheLoadFailed(false);
    } catch {
      setCachedVersions([]);
      setCacheLoadFailed(true);
    }
  }, [poolId]);

  const loadGallery = useCallback(async () => {
    if (!poolId) return;
    setGalleryLoading(true);
    setGalleryEnriching(false);
    setGalleryErr(null);
    void loadRunningNames();
    void loadCacheList();
    try {
      const list = await fetchXinferenceModelRegistrations(poolId, modelType, {
        skipCache: true,
        detailed: false,
      });
      setGallery(list);
    } catch (e: unknown) {
      setGallery([]);
      setGalleryErr(e instanceof Error ? e.message : '加载模型广场失败');
      return;
    } finally {
      setGalleryLoading(false);
    }

    setGalleryEnriching(true);
    try {
      const detailed = await fetchXinferenceModelRegistrations(poolId, modelType, {
        skipCache: true,
        detailed: true,
      });
      setGallery(detailed);
    } catch {
      /* 保留简要列表 */
    } finally {
      setGalleryEnriching(false);
    }
  }, [poolId, modelType, loadRunningNames, loadCacheList]);

  useEffect(() => {
    void loadGallery();
  }, [loadGallery]);

  const handleModelTypeChange = (key: string) => {
    setModelType(key as XinferenceGalleryModelType);
    setFilter(DEFAULT_GALLERY_FILTER);
  };

  const filterCounts = useMemo(
    () => countGalleryFilterDimensions(gallery, runningNames, cachedVersions),
    [gallery, runningNames, cachedVersions],
  );

  const abilityOptions = useMemo(() => collectAbilityOptions(gallery), [gallery]);

  const filteredGallery = useMemo(
    () => filterGalleryRegistrations(gallery, runningNames, filter, cachedVersions),
    [gallery, runningNames, filter, cachedVersions],
  );

  const resetFilter = () => setFilter(DEFAULT_GALLERY_FILTER);

  const openLaunchFor = (item: XinferenceModelRegistration) => {
    setLaunchTarget(item);
    setLaunchOpen(true);
  };

  const openDetail = async (item: XinferenceModelRegistration) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailJson('');
    try {
      const detail = await fetchXinferenceModelRegistrationDetail(poolId, modelType, item.modelName, {
        skipCache: true,
      });
      setDetailJson(JSON.stringify(detail, null, 2));
    } catch (e: unknown) {
      setDetailJson(e instanceof Error ? e.message : '加载详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleLaunched = useCallback(() => {
    setLaunchOpen(false);
    setLaunchTarget(null);
    void loadRunningNames();
    void loadCacheList();
    navigate(`${xinferencePoolPathForTab(poolId, 'running_models')}&status=creating`);
  }, [loadCacheList, loadRunningNames, navigate, poolId]);

  if (!poolId) {
    return <Alert type="warning" message="缺少资源池参数" showIcon />;
  }

  return (
    <>
      <PageDetailSection
        title="模型广场"
        icon={<ShopOutlined style={{ color: '#1677ff', fontSize: 20 }} />}
        asCard={false}
      >
        <Tabs
          activeKey={modelType}
          onChange={handleModelTypeChange}
          items={XINFERENCE_GALLERY_MODEL_TYPES.map((t) => ({ key: t.key, label: t.label }))}
        />

        <div
          style={{
            marginBottom: 16,
            padding: '12px 16px',
            background: '#fafafa',
            borderRadius: 8,
            border: '1px solid #f0f0f0',
          }}
        >
          <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 12 }}>
            <Typography.Text type="secondary">
              当前 Tab 共 {filterCounts.total} 个 · 筛选结果 {filteredGallery.length} 个
              {galleryEnriching ? ' · 正在补全详情…' : ''}
            </Typography.Text>
            <Space wrap>
              {hasActiveGalleryFilter(filter) ? (
                <Button type="link" size="small" onClick={resetFilter}>
                  重置筛选
                </Button>
              ) : null}
              <Button
                type="primary"
                icon={<ReloadOutlined />}
                loading={galleryLoading || galleryEnriching}
                onClick={() => void loadGallery()}
              >
                更新
              </Button>
            </Space>
          </Flex>

          {cacheLoadFailed ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="无法拉取集群缓存列表，「本地缓存」筛选不可用"
            />
          ) : null}

          <Flex vertical gap={10}>
            <Flex wrap="wrap" gap={12} align="center">
              <Typography.Text type="secondary" style={{ flexShrink: 0 }}>
                运行
              </Typography.Text>
              <Segmented
                value={filter.runtime}
                options={runtimeSegmentOptions(filterCounts)}
                onChange={(v) => setFilter((f) => ({ ...f, runtime: v }))}
              />
            </Flex>
            <Flex wrap="wrap" gap={12} align="center">
              <Typography.Text type="secondary" style={{ flexShrink: 0 }}>
                本地缓存
              </Typography.Text>
              <Segmented
                value={filter.cache}
                options={cacheSegmentOptions(filterCounts, !cacheLoadFailed)}
                onChange={(v) => setFilter((f) => ({ ...f, cache: v }))}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                权重已在 Worker 磁盘，启动时可跳过下载
              </Typography.Text>
            </Flex>
            <Flex wrap="wrap" gap={8} align="center">
              {abilityOptions.length > 0 ? (
                <Select
                  allowClear
                  placeholder="模型能力"
                  style={{ width: 168 }}
                  value={filter.ability}
                  options={abilityOptions.map((a) => ({
                    label: ABILITY_LABELS[a] ?? a,
                    value: a,
                  }))}
                  onChange={(v) => setFilter((f) => ({ ...f, ability: v ?? null }))}
                />
              ) : null}
              <Input
                allowClear
                placeholder="搜索名称、描述、能力标签"
                style={{ width: 300, maxWidth: '100%' }}
                suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />}
                value={filter.keyword}
                onChange={(e) => setFilter((f) => ({ ...f, keyword: e.target.value }))}
              />
            </Flex>
          </Flex>
        </div>

        {galleryErr && <Alert type="error" message={galleryErr} showIcon style={{ marginBottom: 16 }} />}

        <Spin spinning={galleryLoading}>
          {filteredGallery.length === 0 ? (
            <Empty description={galleryFilterEmptyDescription(filter, modelTypeLabel(modelType))} />
          ) : (
            <Row gutter={[16, 16]}>
              {filteredGallery.map((item) => (
                <Col key={item.modelName} xs={24} sm={12} lg={8} xl={6}>
                  <ModelRegistrationCard
                    item={{ ...item, modelType }}
                    running={runningNames.has(item.modelName)}
                    cached={modelNameHasAnyCache(item.modelName, cachedVersions)}
                    cachedVersionCount={cachedVersionCountForModel(item.modelName, cachedVersions)}
                    onLaunch={() => openLaunchFor(item)}
                    onDetail={() => void openDetail(item)}
                  />
                </Col>
              ))}
            </Row>
          )}
        </Spin>
      </PageDetailSection>

      <LaunchModelDrawer
        open={launchOpen}
        poolId={poolId}
        modelType={modelType}
        launchTarget={launchTarget}
        onClose={() => {
          setLaunchOpen(false);
          setLaunchTarget(null);
        }}
        onLaunched={handleLaunched}
      />

      <Modal
        title="模型详情"
        open={detailOpen}
        footer={null}
        onCancel={() => setDetailOpen(false)}
        width={720}
        destroyOnHidden
      >
        <Spin spinning={detailLoading}>
          <pre
            style={{
              margin: 0,
              maxHeight: 480,
              overflow: 'auto',
              background: '#f8fafc',
              padding: 12,
              borderRadius: 8,
              fontSize: 12,
            }}
          >
            {detailJson || ' '}
          </pre>
        </Spin>
      </Modal>
    </>
  );
};

export default ModelGallerySection;
