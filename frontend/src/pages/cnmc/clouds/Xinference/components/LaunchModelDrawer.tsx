import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Collapse,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Spin,
  Switch,
  Typography,
  message,
} from 'antd';
import { buildLaunchPayload } from '../lib/buildLaunchPayload';
import {
  coerceSelectValue,
  displaySize,
  firstAvailableEngine,
  formatsFor,
  hasSizeDimension,
  isGgufFamily,
  parseEnginesResponse,
  projectorsFor,
  quantizationsFor,
  selectLabel,
  sizesFor,
  type ParsedEngines,
} from '../lib/launchEnginesCascade';
import {
  LAUNCH_PROGRESS_POLL_MS,
  launchProgressHint,
  matchModelInstanceUid,
  notifyCancelLaunchFailure,
} from '../lib/launchProgressUtils';
import {
  DOWNLOAD_HUB_OPTIONS,
  buildNGpuOptions,
  defaultLaunchFormValues,
  totalClusterGpuCount,
  type LaunchFormValues,
} from '../lib/launchModelForm';
import {
  XINFERENCE_GALLERY_MODEL_TYPES,
  type XinferenceGalleryModelType,
} from '../lib/xinferenceModelRegistry';
import {
  cancelXinferenceModelLaunch,
  fetchXinferenceCachedModels,
  fetchXinferenceClusterInfo,
  fetchXinferenceLaunchProgress,
  fetchXinferenceModelEngines,
  fetchXinferenceModelInstances,
  launchXinferenceModel,
  type XinferenceModelRegistration,
} from '../../../../../services/xinferenceApi';

const MAX_POLL_MS = 30 * 60 * 1000;

type Props = {
  open: boolean;
  poolId: string;
  modelType: XinferenceGalleryModelType;
  launchTarget: XinferenceModelRegistration | null;
  onClose: () => void;
  onLaunched: (modelUid: string) => void;
};

function cacheKeyForCombo(
  modelName: string,
  size: string | undefined,
  format: string | undefined,
  quantization: string | undefined,
): string {
  if (!format || !quantization) return '';
  const sizePart = size ? `${size.replace(/\./g, '_')}B` : '';
  const parts = [modelName, sizePart, format, quantization].filter(Boolean);
  return parts.join('--');
}

const LaunchModelDrawer: React.FC<Props> = ({
  open,
  poolId,
  modelType,
  launchTarget,
  onClose,
  onLaunched,
}) => {
  const [form] = Form.useForm<LaunchFormValues>();
  const modelTypeWatch = Form.useWatch('model_type', form) || modelType;
  const engineWatch = Form.useWatch('model_engine', form);
  const formatWatch = Form.useWatch('model_format', form);
  const sizeWatch = Form.useWatch('model_size_in_billions', form);
  const thinkingWatch = Form.useWatch('enable_thinking', form);

  const [parsedEngines, setParsedEngines] = useState<ParsedEngines | null>(null);
  const [enginesLoading, setEnginesLoading] = useState(false);
  const [enginesErr, setEnginesErr] = useState<string | null>(null);
  const [cachedVersions, setCachedVersions] = useState<string[]>([]);
  const [gpuOptions, setGpuOptions] = useState(() => buildNGpuOptions(0));

  const [phase, setPhase] = useState<'form' | 'progress'>('form');
  const [submitting, setSubmitting] = useState(false);
  const [launchModelUid, setLaunchModelUid] = useState('');
  const [launchModelName, setLaunchModelName] = useState('');
  const [progress, setProgress] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [cancelAttempted, setCancelAttempted] = useState(false);

  const pollStartedAtRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const launchedRef = useRef(false);

  const abilities = launchTarget?.abilities ?? [];
  const showThinking = abilities.includes('hybrid');
  const showReasoning = abilities.includes('reasoning') && thinkingWatch === true;
  const showSize = useMemo(() => {
    if (!parsedEngines || !engineWatch || !formatWatch) return false;
    return hasSizeDimension(parsedEngines, engineWatch, formatWatch);
  }, [parsedEngines, engineWatch, formatWatch]);

  const showProjectors = useMemo(() => {
    if (!parsedEngines || !engineWatch || !formatWatch) return false;
    return (
      projectorsFor(parsedEngines, engineWatch, formatWatch, showSize ? sizeWatch : undefined)
        .length > 0
    );
  }, [parsedEngines, engineWatch, formatWatch, showSize, sizeWatch]);

  const engineSelectOptions = useMemo(() => {
    if (!parsedEngines) return [];
    return parsedEngines.engines.map((e) => ({
      value: e.name,
      label: e.available ? e.name : `${e.name}（不可用）`,
      disabled: !e.available,
      title: e.reason,
    }));
  }, [parsedEngines]);

  const formatOptions = useMemo(() => {
    if (!parsedEngines || !engineWatch) return [];
    return formatsFor(parsedEngines, engineWatch).map((f) => ({ value: f, label: f }));
  }, [parsedEngines, engineWatch]);

  const sizeOptions = useMemo(() => {
    if (!parsedEngines || !engineWatch || !formatWatch) return [];
    return sizesFor(parsedEngines, engineWatch, formatWatch).map((s) => ({
      value: s,
      label: displaySize(s),
    }));
  }, [parsedEngines, engineWatch, formatWatch]);

  const quantOptions = useMemo(() => {
    if (!parsedEngines || !engineWatch || !formatWatch) return [];
    const modelName = launchTarget?.modelName ?? '';
    return quantizationsFor(
      parsedEngines,
      engineWatch,
      formatWatch,
      showSize ? sizeWatch : undefined,
    ).map((q) => {
      const key = cacheKeyForCombo(modelName, showSize ? sizeWatch : undefined, formatWatch, q);
      const cached = cachedVersions.some((v) => v.includes(key) || v.endsWith(`--${q}`));
      return { value: q, label: selectLabel(q, cached) };
    });
  }, [
    parsedEngines,
    engineWatch,
    formatWatch,
    sizeWatch,
    showSize,
    launchTarget?.modelName,
    cachedVersions,
  ]);

  const projectorOptions = useMemo(() => {
    if (!parsedEngines || !engineWatch || !formatWatch) return [];
    return projectorsFor(
      parsedEngines,
      engineWatch,
      formatWatch,
      showSize ? sizeWatch : undefined,
    ).map((p) => ({ value: p, label: p }));
  }, [parsedEngines, engineWatch, formatWatch, showSize, sizeWatch]);

  const resetLaunchState = useCallback(() => {
    setPhase('form');
    setSubmitting(false);
    setLaunchModelUid('');
    setLaunchModelName('');
    setProgress(0);
    setCancelling(false);
    launchedRef.current = false;
    setCancelAttempted(false);
    pollStartedAtRef.current = 0;
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    if (phase === 'progress' && !launchedRef.current) {
      Modal.confirm({
        title: '启动尚未完成',
        content: '关闭抽屉不会停止后台加载，可在「运行模型」查看进度；也可先取消启动。',
        okText: '仍要关闭',
        cancelText: '继续等待',
        onOk: () => {
          resetLaunchState();
          form.resetFields();
          setParsedEngines(null);
          setEnginesErr(null);
          onClose();
        },
      });
      return;
    }
    resetLaunchState();
    form.resetFields();
    setParsedEngines(null);
    setEnginesErr(null);
    onClose();
  }, [form, onClose, phase, resetLaunchState]);

  const applyCascade = useCallback(
    (parsed: ParsedEngines, prev?: Partial<LaunchFormValues>) => {
      const engine =
        coerceSelectValue(
          parsed.engines.filter((e) => e.available).map((e) => e.name),
          prev?.model_engine,
        ) ?? firstAvailableEngine(parsed)?.name;
      if (!engine) return;

      const format = coerceSelectValue(formatsFor(parsed, engine), prev?.model_format);
      const needSize = format ? hasSizeDimension(parsed, engine, format) : false;
      const size = needSize
        ? coerceSelectValue(
            sizesFor(parsed, engine, format!),
            prev?.model_size_in_billions,
          )
        : undefined;
      const quant = coerceSelectValue(
        quantizationsFor(parsed, engine, format!, needSize ? size : undefined),
        prev?.quantization,
      );
      const projectors = format
        ? projectorsFor(parsed, engine, format, needSize ? size : undefined)
        : [];
      const projector = coerceSelectValue(projectors, prev?.multimodal_projector);

      form.setFieldsValue({
        model_engine: engine,
        model_format: format,
        model_size_in_billions: size,
        quantization: quant,
        multimodal_projector: projector,
      });
    },
    [form],
  );

  useEffect(() => {
    if (!open) {
      resetLaunchState();
      return;
    }
    if (!launchTarget) return;

    const name = launchTarget.modelName;
    form.setFieldsValue(defaultLaunchFormValues(modelType, name));

    setEnginesLoading(true);
    setEnginesErr(null);
    setParsedEngines(null);

    void (async () => {
      try {
        const [enginesRaw, cluster, cached] = await Promise.all([
          fetchXinferenceModelEngines(poolId, modelType, name, { skipCache: true }),
          fetchXinferenceClusterInfo(poolId, { skipCache: true }).catch(() => null),
          fetchXinferenceCachedModels(poolId, name, { skipCache: true }).catch(() => []),
        ]);
        const parsed = parseEnginesResponse(enginesRaw);
        if (!parsed.engines.some((e) => e.available)) {
          setEnginesErr('该模型暂无可用推理引擎，请检查 Xinference 依赖是否已安装');
        }
        setParsedEngines(parsed);
        setCachedVersions(cached);
        if (cluster) {
          const gpuN = totalClusterGpuCount(
            cluster.workerDetails,
            cluster.workersSummary.gpuCount,
            cluster.supervisor.gpuCount,
          );
          setGpuOptions(buildNGpuOptions(gpuN));
        }
        applyCascade(parsed);
      } catch (e: unknown) {
        setEnginesErr(e instanceof Error ? e.message : '拉取引擎组合失败');
      } finally {
        setEnginesLoading(false);
      }
    })();
  }, [open, launchTarget, modelType, poolId, form, resetLaunchState, applyCascade]);

  useEffect(() => {
    if (!parsedEngines || !engineWatch) return;
    const format = coerceSelectValue(formatsFor(parsedEngines, engineWatch), formatWatch);
    if (format !== formatWatch) {
      form.setFieldsValue({
        model_format: format,
        model_size_in_billions: undefined,
        quantization: undefined,
        multimodal_projector: undefined,
      });
    }
  }, [parsedEngines, engineWatch, formatWatch, form]);

  useEffect(() => {
    if (!parsedEngines || !engineWatch || !formatWatch) return;
    const needSize = hasSizeDimension(parsedEngines, engineWatch, formatWatch);
    const size = needSize
      ? coerceSelectValue(
          sizesFor(parsedEngines, engineWatch, formatWatch),
          sizeWatch,
        )
      : undefined;
    const quant = coerceSelectValue(
      quantizationsFor(parsedEngines, engineWatch, formatWatch, needSize ? size : undefined),
      form.getFieldValue('quantization'),
    );
    const projectors = projectorsFor(
      parsedEngines,
      engineWatch,
      formatWatch,
      needSize ? size : undefined,
    );
    const projector = coerceSelectValue(projectors, form.getFieldValue('multimodal_projector'));
    form.setFieldsValue({
      model_size_in_billions: size,
      quantization: quant,
      multimodal_projector: projector,
    });
  }, [parsedEngines, engineWatch, formatWatch, sizeWatch, form]);

  const finishLaunch = useCallback(
    (modelUid: string) => {
      if (launchedRef.current) return;
      launchedRef.current = true;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      setProgress(1);
      message.success(`模型已就绪：${modelUid}`);
      resetLaunchState();
      form.resetFields();
      setParsedEngines(null);
      onLaunched(modelUid);
    },
    [form, onLaunched, resetLaunchState],
  );

  const pollLaunchProgress = useCallback(async () => {
    if (!poolId || !launchModelUid || launchedRef.current) return;

    if (Date.now() - pollStartedAtRef.current > MAX_POLL_MS) {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      message.warning('启动耗时较长，请稍后在「运行模型」中查看');
      return;
    }

    try {
      const [ratio, instancesRes] = await Promise.all([
        fetchXinferenceLaunchProgress(poolId, launchModelUid),
        fetchXinferenceModelInstances(poolId, { skipCache: true }).catch(() => null),
      ]);
      setProgress(ratio);

      const inst = instancesRes?.instances?.find((i) =>
        matchModelInstanceUid(i.modelUid, launchModelUid),
      );
      const status = inst?.status?.toUpperCase();
      if (status === 'READY' || ratio >= 0.999) {
        finishLaunch(launchModelUid);
        return;
      }
      if (status === 'ERROR') {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        message.error(inst?.errorMessage || '模型启动失败，请查看集群日志');
      }
    } catch {
      /* 轮询偶发失败时继续 */
    }
  }, [finishLaunch, launchModelUid, poolId]);

  useEffect(() => {
    if (phase !== 'progress' || !launchModelUid) return;
    void pollLaunchProgress();
    pollTimerRef.current = setInterval(() => void pollLaunchProgress(), LAUNCH_PROGRESS_POLL_MS);
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [phase, launchModelUid, pollLaunchProgress]);

  const submitLaunch = async () => {
    const values = await form.validateFields();
    const payload = buildLaunchPayload(
      values.model_name,
      values.model_type || modelType,
      values,
    );
    if (String(modelTypeWatch || modelType) === 'LLM' && !payload.model_engine) {
      message.error('请选择推理引擎');
      return;
    }

    setSubmitting(true);
    try {
      const { modelUid } = await launchXinferenceModel(poolId, payload, { waitReady: false });
      setLaunchModelUid(modelUid);
      setLaunchModelName(values.model_name);
      setProgress(0);
      pollStartedAtRef.current = Date.now();
      setPhase('progress');
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '提交启动失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelLaunch = async () => {
    if (!launchModelUid) return;
    if (cancelAttempted) {
      message.warning('已请求取消该模型，请勿重复操作');
      return;
    }
    setCancelling(true);
    setCancelAttempted(true);
    try {
      await cancelXinferenceModelLaunch(poolId, launchModelUid);
      message.info('已请求取消启动');
      resetLaunchState();
      form.resetFields();
      setParsedEngines(null);
      onClose();
    } catch (e: unknown) {
      notifyCancelLaunchFailure(e);
    } finally {
      setCancelling(false);
    }
  };

  const percent = Math.round(progress * 100);
  const title =
    phase === 'progress'
      ? `正在启动 · ${launchModelName || launchTarget?.modelName || ''}`
      : launchTarget
        ? `启动 · ${launchTarget.modelName}`
        : '启动模型';

  return (
    <Drawer
      title={title}
      open={open}
      width={560}
      destroyOnClose
      maskClosable={phase !== 'progress'}
      closable={!submitting && !cancelling}
      onClose={handleClose}
      footer={
        phase === 'progress' ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button
              danger
              loading={cancelling}
              disabled={cancelAttempted}
              onClick={() => void handleCancelLaunch()}
            >
              {cancelAttempted ? '已请求取消' : '取消启动'}
            </Button>
            <Button onClick={handleClose}>后台继续</Button>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={handleClose}>关闭</Button>
            <Button
              type="primary"
              loading={submitting || enginesLoading}
              disabled={!!enginesErr || !parsedEngines?.engines.some((e) => e.available)}
              onClick={() => void submitLaunch()}
            >
              提交启动
            </Button>
          </div>
        )
      }
    >
      {phase === 'progress' ? (
        <div style={{ paddingTop: 8 }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
            正在后台加载模型。关闭抽屉后任务仍会继续，可在「运行模型」查看进度。
          </Typography.Paragraph>
          <Progress percent={percent} status={percent >= 100 ? 'success' : 'active'} />
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
            {launchProgressHint(progress)}
          </Typography.Text>
          {launchModelUid ? (
            <Typography.Text
              type="secondary"
              copyable
              style={{ display: 'block', marginTop: 8, fontSize: 12 }}
            >
              UID: {launchModelUid}
            </Typography.Text>
          ) : null}
        </div>
      ) : (
        <Spin spinning={enginesLoading}>
          {enginesErr ? (
            <Alert type="error" showIcon message={enginesErr} style={{ marginBottom: 12 }} />
          ) : (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="提交后将在后台加载；首次启动可能需从 ModelScope 等源下载权重。"
            />
          )}
          <Form form={form} layout="vertical" className="std-form">
            <Form.Item name="model_type" label="模型类型" rules={[{ required: true }]}>
              <Select
                options={XINFERENCE_GALLERY_MODEL_TYPES.map((t) => ({
                  value: t.key,
                  label: t.label,
                }))}
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
                  required: String(modelTypeWatch) === 'LLM',
                  message: '请选择推理引擎',
                },
              ]}
            >
              <Select
                placeholder="选择引擎"
                options={engineSelectOptions}
                optionRender={(opt) => (
                  <span title={String(opt.data?.title ?? '')}>{opt.label}</span>
                )}
              />
            </Form.Item>
            <Form.Item
              name="model_format"
              label="模型格式"
              rules={[{ required: true, message: '请选择模型格式' }]}
            >
              <Select placeholder="选择格式" options={formatOptions} disabled={!engineWatch} />
            </Form.Item>
            {showSize ? (
              <Form.Item
                name="model_size_in_billions"
                label="参数规模"
                rules={[{ required: true, message: '请选择参数规模' }]}
              >
                <Select placeholder="选择规模" options={sizeOptions} disabled={!formatWatch} />
              </Form.Item>
            ) : (
              <Form.Item name="model_size_in_billions" hidden>
                <Input />
              </Form.Item>
            )}
            <Form.Item
              name="quantization"
              label="量化"
              rules={[{ required: true, message: '请选择量化方式' }]}
            >
              <Select placeholder="选择量化" options={quantOptions} disabled={!formatWatch} />
            </Form.Item>
            {showProjectors ? (
              <Form.Item name="multimodal_projector" label="多模态投影器">
                <Select options={projectorOptions} />
              </Form.Item>
            ) : null}
            <Form.Item name="n_gpu" label="GPU 数量">
              <Select options={gpuOptions} />
            </Form.Item>
            {isGgufFamily(formatWatch) ? (
              <Form.Item
                name="n_gpu_layers"
                label="GPU 层数"
                tooltip="小于 0 时不提交该字段（使用引擎默认）"
              >
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
            ) : null}
            <Form.Item name="replica" label="副本数">
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="download_hub" label="下载源">
              <Select options={DOWNLOAD_HUB_OPTIONS} />
            </Form.Item>
            {showThinking ? (
              <Form.Item name="enable_thinking" label="思考模式" valuePropName="checked">
                <Switch />
              </Form.Item>
            ) : null}
            {showReasoning ? (
              <Form.Item name="reasoning_content" label="解析推理内容" valuePropName="checked">
                <Switch />
              </Form.Item>
            ) : null}
            <Collapse
              ghost
              items={[
                {
                  key: 'advanced',
                  label: '高级选项',
                  children: (
                    <>
                      <Form.Item name="model_uid" label="模型 UID">
                        <Input placeholder="留空则使用模型名称" />
                      </Form.Item>
                      <Form.Item name="request_limits" label="请求限制">
                        <InputNumber min={1} style={{ width: '100%' }} placeholder="留空表示不限" />
                      </Form.Item>
                      <Form.Item name="model_path" label="本地模型路径">
                        <Input placeholder="指定后跳过下载" />
                      </Form.Item>
                      <Form.Item name="gpu_idx" label="GPU 索引">
                        <Input placeholder="如 0,1" />
                      </Form.Item>
                    </>
                  ),
                },
              ]}
            />
          </Form>
        </Spin>
      )}
    </Drawer>
  );
};

export default LaunchModelDrawer;