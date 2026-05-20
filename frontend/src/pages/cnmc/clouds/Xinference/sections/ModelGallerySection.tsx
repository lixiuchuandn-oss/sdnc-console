/**
 * Xinference 资源池 · 模型广场（浏览注册表并启动）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Tabs,
  Typography,
  message,
} from 'antd';
import { ReloadOutlined, ShopOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageDetailSection from '../../../../../components/PageDetailSection';
import { xinferencePoolPathForTab } from '../../../../../layouts/admin/xinference/xinferencePoolSidebar';
import ModelRegistrationCard from '../components/ModelRegistrationCard';
import {
  ENGINE_OPTIONS,
  FORMAT_OPTIONS,
  hintsFromRegistrationDetail,
  type LaunchFormValues,
} from '../lib/launchModelForm';
import {
  XINFERENCE_GALLERY_MODEL_TYPES,
  collectAbilityOptions,
  filterGalleryRegistrations,
  modelTypeLabel,
  type GalleryFilterState,
  type XinferenceGalleryModelType,
} from '../lib/xinferenceModelRegistry';
import {
  fetchXinferenceModelRegistrationDetail,
  fetchXinferenceModelRegistrations,
  fetchXinferenceRunningModels,
  launchXinferenceModel,
  type XinferenceLaunchModelPayload,
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
  const [galleryErr, setGalleryErr] = useState<string | null>(null);
  const [runningNames, setRunningNames] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<GalleryFilterState>({
    keyword: '',
    ability: null,
    status: 'all',
  });

  const [launchOpen, setLaunchOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchTarget, setLaunchTarget] = useState<XinferenceModelRegistration | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailJson, setDetailJson] = useState<string>('');
  const [form] = Form.useForm<LaunchFormValues>();

  const modelTypeWatch = Form.useWatch('model_type', form);

  const loadRunningNames = useCallback(async () => {
    if (!poolId) return;
    try {
      const list = await fetchXinferenceRunningModels(poolId, { skipCache: true });
      setRunningNames(new Set(list.map((m) => m.modelName).filter(Boolean)));
    } catch {
      setRunningNames(new Set());
    }
  }, [poolId]);

  const loadGallery = useCallback(async () => {
    if (!poolId) return;
    setGalleryLoading(true);
    setGalleryErr(null);
    try {
      const [list] = await Promise.all([
        fetchXinferenceModelRegistrations(poolId, modelType, {
          skipCache: true,
          detailed: true,
        }),
        loadRunningNames(),
      ]);
      setGallery(list);
    } catch (e: unknown) {
      setGallery([]);
      setGalleryErr(e instanceof Error ? e.message : '加载模型广场失败');
    } finally {
      setGalleryLoading(false);
    }
  }, [poolId, modelType, loadRunningNames]);

  useEffect(() => {
    void loadGallery();
  }, [loadGallery]);

  const abilityOptions = useMemo(() => collectAbilityOptions(gallery), [gallery]);

  const filteredGallery = useMemo(
    () => filterGalleryRegistrations(gallery, runningNames, filter),
    [gallery, runningNames, filter],
  );

  const openLaunchFor = async (item: XinferenceModelRegistration) => {
    setLaunchTarget(item);
    form.setFieldsValue({
      model_type: modelType,
      model_name: item.modelName,
      model_engine: modelType === 'LLM' ? 'vllm' : undefined,
      model_format: 'pytorch',
      n_gpu: 'auto',
      replica: 1,
    });
    setLaunchOpen(true);
    try {
      const detail = await fetchXinferenceModelRegistrationDetail(poolId, modelType, item.modelName, {
        skipCache: true,
      });
      const hints = hintsFromRegistrationDetail(detail);
      form.setFieldsValue({
        model_engine: hints.model_engine || form.getFieldValue('model_engine'),
        model_format: hints.model_format || form.getFieldValue('model_format'),
        model_size_in_billions: hints.model_size_in_billions || form.getFieldValue('model_size_in_billions'),
      });
    } catch {
      /* 保留默认项 */
    }
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

  const submitLaunch = async () => {
    const values = await form.validateFields();
    const payload: XinferenceLaunchModelPayload = {
      model_name: values.model_name,
      model_type: values.model_type || modelType,
    };
    if (values.model_engine) payload.model_engine = values.model_engine;
    if (values.model_size_in_billions) payload.model_size_in_billions = values.model_size_in_billions;
    if (values.model_format) payload.model_format = values.model_format;
    if (values.quantization) payload.quantization = values.quantization;
    if (values.model_uid?.trim()) payload.model_uid = values.model_uid.trim();
    if (values.n_gpu != null && String(values.n_gpu).trim()) payload.n_gpu = String(values.n_gpu).trim();
    if (values.replica != null) payload.replica = values.replica;

    setLaunching(true);
    try {
      const { modelUid } = await launchXinferenceModel(poolId, payload);
      message.success(`模型已提交启动：${modelUid}`);
      setLaunchOpen(false);
      setLaunchTarget(null);
      form.resetFields();
      navigate(xinferencePoolPathForTab(poolId, 'running_models'));
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '启动模型失败');
    } finally {
      setLaunching(false);
    }
  };

  if (!poolId) {
    return <Alert type="warning" message="缺少资源池参数" showIcon />;
  }

  return (
    <>
      <PageDetailSection
        title="模型广场"
        icon={<ShopOutlined style={{ color: '#1677ff', fontSize: 20 }} />}
        asCard={false}
        toolbarRight={
          <Typography.Text type="secondary">
            展示 {filteredGallery.length}/{gallery.length} 个 · 已启动 {runningNames.size} 个
          </Typography.Text>
        }
        onRefresh={() => void loadGallery()}
      >
        <Tabs
          activeKey={modelType}
          onChange={(k) => setModelType(k as XinferenceGalleryModelType)}
          items={XINFERENCE_GALLERY_MODEL_TYPES.map((t) => ({ key: t.key, label: t.label }))}
          style={{ marginBottom: 12 }}
          tabBarExtraContent={
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              loading={galleryLoading}
              onClick={() => void loadGallery()}
            >
              更新{modelTypeLabel(modelType)}
            </Button>
          }
        />

        <Space wrap style={{ marginBottom: 16 }}>
          <Select
            allowClear
            placeholder="模型能力"
            style={{ width: 160 }}
            value={filter.ability}
            options={abilityOptions.map((a) => ({ label: a, value: a }))}
            onChange={(v) => setFilter((f) => ({ ...f, ability: v ?? null }))}
          />
          <Select
            placeholder="状态"
            style={{ width: 140 }}
            value={filter.status}
            options={[
              { label: '全部', value: 'all' },
              { label: '已启动', value: 'running' },
              { label: '未启动', value: 'idle' },
            ]}
            onChange={(v) => setFilter((f) => ({ ...f, status: v }))}
          />
          <Input.Search
            allowClear
            placeholder="搜索模型名称和描述"
            style={{ width: 280 }}
            onSearch={(v) => setFilter((f) => ({ ...f, keyword: v }))}
          />
        </Space>

        {galleryErr && <Alert type="error" message={galleryErr} showIcon style={{ marginBottom: 16 }} />}

        <Spin spinning={galleryLoading}>
          {filteredGallery.length === 0 ? (
            <Empty description={`暂无${modelTypeLabel(modelType)}，可点击「更新」同步注册表`} />
          ) : (
            <Row gutter={[16, 16]}>
              {filteredGallery.map((item) => (
                <Col key={item.modelName} xs={24} sm={12} lg={8} xl={6}>
                  <ModelRegistrationCard
                    item={{ ...item, modelType }}
                    running={runningNames.has(item.modelName)}
                    onLaunch={() => void openLaunchFor(item)}
                    onDetail={() => void openDetail(item)}
                  />
                </Col>
              ))}
            </Row>
          )}
        </Spin>
      </PageDetailSection>

      <Modal
        title={launchTarget ? `启动 · ${launchTarget.modelName}` : '启动模型'}
        open={launchOpen}
        onCancel={() => {
          if (launching) return;
          setLaunchOpen(false);
          setLaunchTarget(null);
          form.resetFields();
        }}
        onOk={() => void submitLaunch()}
        confirmLoading={launching}
        destroyOnHidden
        width={560}
        okText="启动"
      >
        <Form form={form} layout="vertical" className="std-form">
          <Form.Item name="model_type" label="模型类型" rules={[{ required: true }]}>
            <Select
              options={XINFERENCE_GALLERY_MODEL_TYPES.map((t) => ({ value: t.key, label: t.label }))}
              disabled={!!launchTarget}
            />
          </Form.Item>
          <Form.Item name="model_name" label="模型名称" rules={[{ required: true }]}>
            <Input disabled={!!launchTarget} />
          </Form.Item>
          <Form.Item
            name="model_engine"
            label="推理引擎"
            rules={[
              {
                required: String(modelTypeWatch || modelType) === 'LLM',
                message: 'LLM 须指定推理引擎',
              },
            ]}
          >
            <Select allowClear options={ENGINE_OPTIONS} placeholder="如 vllm" />
          </Form.Item>
          <Form.Item name="model_size_in_billions" label="参数规模">
            <Input placeholder="如 0_5、7、14" />
          </Form.Item>
          <Form.Item name="model_format" label="模型格式">
            <Select allowClear options={FORMAT_OPTIONS} />
          </Form.Item>
          <Form.Item name="quantization" label="量化">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item name="model_uid" label="模型 UID">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item name="n_gpu" label="GPU">
            <Input placeholder="默认 auto" />
          </Form.Item>
          <Form.Item name="replica" label="副本数">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

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
