/**
 * 虚拟机详情 · 开机自动配置：在未配置时可一键挂载 Cloud-Init；有引用时查看并编辑 Secret 明文。
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { FolderOpenFilled, ReloadOutlined } from "@ant-design/icons";
import CodeEditor, {
  type CodeLanguage,
} from "../../../../../../../components/CodeEditor";
import {
  createHarvesterSecret,
  deleteHarvesterSecret,
  fetchHarvesterSecretDetail,
  patchHarvesterVm,
  updateHarvesterSecret,
} from "../../../../../../../services/harvesterApi";
import {
  cloudInitSecretRefName,
  listCloudInitDiskVolumePairs,
} from "../../lib/vmCloudInitSpec";
import {
  allocateCloudInitDiskSlotName,
  buildOpaqueCloudInitSecretBody,
  buildVmMergePatchForCloudInitDisk,
  proposeCloudInitSecretName,
} from "./lib/enableCloudInitOnVm";
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import "../shared/styles/vmManageDrawer.css";

const CloudInitDrawerHeadIcon = FolderOpenFilled;

/** Secret 里常见键名 → 给非技术用户看的短说明（无映射则只显示原名） */
const SECRET_DATA_KEY_LABEL: Record<string, string> = {
  "user-data": "用户数据",
  userdata: "用户数据",
  networkdata: "网络配置",
  "network-config": "网络配置",
  "meta-data": "可选 meta-data（高级；见上方说明）",
  metadata: "可选元数据键 metadata",
  "vendor-data": "可选 vendor-data",
  vendordata: "可选 vendor-data",
};

function secretDataKeyTitle(key: string): string {
  const hint = SECRET_DATA_KEY_LABEL[key.toLowerCase()];
  return hint ? `${hint}（${key}）` : key;
}

/** 按键名优先级排序编辑器块：主路径靠前，其余按字典序 */
const CLOUDINIT_SECRET_KEY_ORDER = [
  "userdata",
  "user-data",
  "networkdata",
  "network-config",
  "network-data",
  "meta-data",
  "metadata",
  "vendor-data",
];

function compareCloudInitSecretKeys(a: string, b: string): number {
  const la = a.toLowerCase().replace(/_/g, "-");
  const lb = b.toLowerCase().replace(/_/g, "-");
  const ia = CLOUDINIT_SECRET_KEY_ORDER.indexOf(la);
  const ib = CLOUDINIT_SECRET_KEY_ORDER.indexOf(lb);
  const ra = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
  const rb = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
  if (ra !== rb) return ra - rb;
  return la.localeCompare(lb);
}

/** 按常见 cloud-init Secret 键名猜高亮语言 */
function guessLangForSecretKey(key: string): CodeLanguage {
  const k = key.toLowerCase().replace(/_/g, "-");
  if (k === "user-data" || k === "userdata" || k.includes("network"))
    return "yaml";
  if (
    k === "meta-data" ||
    k === "metadata" ||
    k === "vendor-data" ||
    k === "vendordata"
  )
    return "yaml";
  if (k.endsWith(".json") || k.includes("json")) return "json";
  if (k.endsWith(".sh") || k.includes("script")) return "shell";
  return "text";
}

/** user-data / networkdata 体量通常更大，给编辑区明显高于其它键的最小可视高度 */
function cloudInitSecretKeyEditorSizing(dataKey: string): {
  minHeight: number;
  maxHeight: number;
} {
  const k = dataKey.toLowerCase().replace(/_/g, "-");
  if (
    k === "user-data" ||
    k === "userdata" ||
    k === "networkdata" ||
    k === "network-config" ||
    k === "network-data"
  ) {
    return { minHeight: 240, maxHeight: 420 };
  }
  if (
    k === "meta-data" ||
    k === "metadata" ||
    k === "vendor-data" ||
    k === "vendordata"
  ) {
    return { minHeight: 200, maxHeight: 380 };
  }
  return { minHeight: 120, maxHeight: 320 };
}

function isKubeConflict(e: unknown): boolean {
  const err = e as any;
  return err?.response?.status === 409 || err?.status === 409;
}

function secretPayloadEquals(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if ((a[k] ?? "") !== (b[k] ?? "")) return false;
  }
  return true;
}

type SecretLoadState = {
  loading: boolean;
  error?: string;
  stringData?: Record<string, string>;
};

export interface VmCloudInitDrawerProps {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  vmData: any;
  hasEcsWrite: boolean;
  onApplied?: () => void | Promise<void>;
}

const VmCloudInitDrawer: React.FC<VmCloudInitDrawerProps> = ({
  open,
  onClose,
  cloudId,
  vmData,
  hasEcsWrite,
  onApplied,
}) => {
  const vmManageCssVars = useVmManageDrawerCssVars();
  const rows = listCloudInitDiskVolumePairs(vmData);
  const vmNs = useMemo(
    () => String(vmData?.metadata?.namespace ?? "").trim(),
    [vmData],
  );
  const vmName = useMemo(
    () => String(vmData?.metadata?.name ?? "").trim(),
    [vmData],
  );
  const vmUid = useMemo(
    () => String(vmData?.metadata?.uid ?? "").trim(),
    [vmData],
  );

  const secretToDiskNames = useMemo(() => {
    const m = new Map<string, string[]>();
    rows.forEach(({ disk, vol }) => {
      const s = cloudInitSecretRefName(vol);
      if (!s) return;
      const d = String(disk?.name || vol?.name || "").trim() || "—";
      const arr = m.get(s) || [];
      if (!arr.includes(d)) arr.push(d);
      m.set(s, arr);
    });
    return m;
  }, [rows]);

  const secretNamesKey = useMemo(() => {
    const names = [
      ...new Set(
        rows.map((r) => cloudInitSecretRefName(r.vol)).filter(Boolean),
      ),
    ].sort();
    return names.join("\0");
  }, [rows]);

  const [secretByName, setSecretByName] = useState<
    Record<string, SecretLoadState>
  >({});
  const [draftBySecret, setDraftBySecret] = useState<
    Record<string, Record<string, string>>
  >({});
  const [baselineBySecret, setBaselineBySecret] = useState<
    Record<string, Record<string, string>>
  >({});
  const [savingFooter, setSavingFooter] = useState(false);
  const [enablingCi, setEnablingCi] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!open || !cloudId || !vmNs || !secretNamesKey) {
      if (!open) {
        setSecretByName({});
        setDraftBySecret({});
        setBaselineBySecret({});
      }
      return;
    }

    const names = secretNamesKey.split("\0").filter(Boolean);
    if (names.length === 0) {
      setSecretByName({});
      setDraftBySecret({});
      setBaselineBySecret({});
      return;
    }

    setSecretByName(
      Object.fromEntries(names.map((n) => [n, { loading: true }])),
    );

    let cancelled = false;
    names.forEach((name) => {
      fetchHarvesterSecretDetail(cloudId, vmNs, name, true, true)
        .then((res) => {
          if (cancelled) return;
          const sd =
            res?.data?.stringData && typeof res.data.stringData === "object"
              ? (res.data.stringData as Record<string, string>)
              : {};
          setSecretByName((prev) => ({
            ...prev,
            [name]: {
              loading: false,
              stringData: sd,
            },
          }));
          setDraftBySecret((prev) => ({ ...prev, [name]: { ...sd } }));
          setBaselineBySecret((prev) => ({ ...prev, [name]: { ...sd } }));
        })
        .catch((e: any) => {
          if (cancelled) return;
          setSecretByName((prev) => ({
            ...prev,
            [name]: {
              loading: false,
              error:
                e?.message ||
                String(e?.response?.data?.message ?? "") ||
                "加载失败",
            },
          }));
        });
    });

    return () => {
      cancelled = true;
    };
  }, [open, cloudId, vmNs, secretNamesKey, reloadTick]);

  const reloadSecrets = useCallback(() => {
    if (!secretNamesKey) return;
    setReloadTick((t) => t + 1);
  }, [secretNamesKey]);
  const updateDraftKey = useCallback((secret: string, dataKey: string, text: string) => {
    setDraftBySecret((prev) => ({
      ...prev,
      [secret]: { ...(prev[secret] || {}), [dataKey]: text },
    }));
  }, []);

  const dirtyMeta = useMemo(() => {
    const names = secretNamesKey.split("\0").filter(Boolean);
    const dirtyNames = names.filter(
      (n) =>
        !secretPayloadEquals(draftBySecret[n], baselineBySecret[n]),
    );
    return { anyDirty: dirtyNames.length > 0, dirtyCount: dirtyNames.length };
  }, [secretNamesKey, draftBySecret, baselineBySecret]);

  const { anyDirty, dirtyCount } = dirtyMeta;

  const handleSaveAllDirty = useCallback(async () => {
    if (!hasEcsWrite || !cloudId || !vmNs) return;
    const names = secretNamesKey.split("\0").filter(Boolean);
    const toSave = names.filter(
      (n) =>
        !secretPayloadEquals(draftBySecret[n], baselineBySecret[n]),
    );
    if (toSave.length === 0) return;
    setSavingFooter(true);
    try {
      for (const secret of toSave) {
        const stringData = draftBySecret[secret];
        if (!stringData) continue;
        await updateHarvesterSecret(cloudId, vmNs, secret, {
          stringData,
        });
        const res = await fetchHarvesterSecretDetail(
          cloudId,
          vmNs,
          secret,
          true,
          true,
        );
        const sd =
          res?.data?.stringData && typeof res.data.stringData === "object"
            ? (res.data.stringData as Record<string, string>)
            : {};
        setSecretByName((prev) => ({
          ...prev,
          [secret]: { loading: false, stringData: sd },
        }));
        setDraftBySecret((prev) => ({ ...prev, [secret]: { ...sd } }));
        setBaselineBySecret((prev) => ({ ...prev, [secret]: { ...sd } }));
      }
      message.success("已保存到集群");
      await onApplied?.();
    } catch (e: any) {
      message.error(e?.message || "保存失败");
    } finally {
      setSavingFooter(false);
    }
  }, [
    hasEcsWrite,
    cloudId,
    vmNs,
    secretNamesKey,
    draftBySecret,
    baselineBySecret,
    onApplied,
  ]);

  const handleEnableCloudInit = useCallback(async () => {
    if (!hasEcsWrite || !cloudId || !vmNs || !vmName) return;
    if (listCloudInitDiskVolumePairs(vmData).length > 0) {
      message.warning("已检测到 Cloud-Init 配置，请先关闭抽屉并刷新虚拟机后再试");
      return;
    }
    setEnablingCi(true);
    try {
      const diskSlotName = allocateCloudInitDiskSlotName(vmData);

      let secretName = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = proposeCloudInitSecretName(vmName);
        try {
          const body = buildOpaqueCloudInitSecretBody(candidate, vmNs, vmName);
          await createHarvesterSecret(cloudId, vmNs, body);
          secretName = candidate;
          break;
        } catch (e: unknown) {
          if (isKubeConflict(e) && attempt < 4) continue;
          throw e;
        }
      }
      if (!secretName) {
        throw new Error("无法创建 Secret，请稍后重试");
      }

      const patchPayload = buildVmMergePatchForCloudInitDisk(vmData, diskSlotName, secretName);
      try {
        await patchHarvesterVm(cloudId, vmNs, vmName, patchPayload);
      } catch (patchErr: unknown) {
        try {
          await deleteHarvesterSecret(cloudId, vmNs, secretName);
        } catch {
          /* 回滚失败不阻塞报错 */
        }
        throw patchErr;
      }

      message.success(
        "已启用开机自动注入（已创建 Secret 并挂载 Cloud-Init 磁盘）。Secret 内已含初始 user-data 与 networkdata。建议重启虚拟机后生效；可在此继续编辑。",
      );
      await onApplied?.();
    } catch (e: any) {
      const msg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        "启用失败";
      message.error(msg);
    } finally {
      setEnablingCi(false);
    }
  }, [hasEcsWrite, cloudId, vmNs, vmName, vmData, onApplied]);

  const secretNameList = secretNamesKey.split("\0").filter(Boolean);
  const secretsFetching =
    rows.length > 0 && secretNameList.some((n) => Boolean(secretByName[n]?.loading));

  return (
    <Drawer
      closable={false}
      width={800}
      placement="right"
      open={open}
      onClose={onClose}
      forceRender
      push={{ distance: 180 }}
      styles={{
        header: { display: "none" },
        body: { padding: 24, paddingBottom: 88 },
      }}
      footer={
        <div className="vmManageDrawer-footerBar">
          <Button onClick={onClose}>关闭</Button>
          {anyDirty && hasEcsWrite ? (
            <Popconfirm
              title="保存到集群？"
              description={
                dirtyCount > 1
                  ? `将覆盖 ${dirtyCount} 处已修改的配置，请确认。`
                  : "将覆盖该配置在集群中保存的内容，请确认。"
              }
              okText="保存"
              cancelText="取消"
              onConfirm={() => void handleSaveAllDirty()}
            >
              <Button type="primary" loading={savingFooter}>
                保存
              </Button>
            </Popconfirm>
          ) : (
            <Button
              type="primary"
              disabled={!hasEcsWrite || !anyDirty}
              loading={savingFooter}
            >
              保存
            </Button>
          )}
        </div>
      }
    >
      <div className="vmManageDrawer vmNicManageDrawer vmCloudInitManageDrawer" style={vmManageCssVars}>
        {rows.length > 0 ? (
          <div className="vmNicManageDrawer-toolbar vmNicManageDrawer-toolbar--end vmCloudInitManageDrawer-toolbar">
            <Tooltip
              title={
                anyDirty
                  ? "存在未保存的修改时无法刷新：请先保存或手动还原编辑内容。"
                  : "从集群重新拉取当前关联的 Secret。"
              }
            >
              <span>
                <Button
                  type="link"
                  icon={<ReloadOutlined />}
                  disabled={
                    enablingCi || anyDirty || secretNameList.length === 0
                  }
                  loading={secretsFetching}
                  onClick={() => void reloadSecrets()}
                  style={{ paddingInline: 6 }}
                >
                  刷新
                </Button>
              </span>
            </Tooltip>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <div className="vmDeviceManageDrawer-emptyState">
            <Empty description="当前虚拟机未配置开机自动注入">
              <Space direction="vertical" size="middle" style={{ marginTop: 8 }}>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0, maxWidth: 480 }}>
                  可一键创建存储 user-data 的 Secret，并在规格中挂载 Cloud-Init（NoCloud）磁盘。
                  <br />
                  若修改虚拟机规格被拒，请将虚拟机关机后重试；生效后建议在合适窗口计划重启。
                </Typography.Paragraph>
                <Popconfirm
                  title="启用开机自动注入？"
                  description="将新建 Secret（含初始 user-data、networkdata），并 PATCH 虚拟机增加 Cloud-Init 磁盘；通常须重启虚拟机后系统在启动时读取配置。"
                  okText="启用"
                  cancelText="取消"
                  disabled={!hasEcsWrite || enablingCi}
                  onConfirm={() => void handleEnableCloudInit()}
                >
                  <Button type="primary" disabled={!hasEcsWrite} loading={enablingCi}>
                    启用开机自动注入
                  </Button>
                </Popconfirm>
              </Space>
            </Empty>
          </div>
        ) : (
          rows.map(({ disk, vol }, i) => {
            const secret = cloudInitSecretRefName(vol);
            const dname =
              String(disk?.name || vol?.name || "").trim() || "—";

            if (!secret) {
              return (
                <div key={`no-secret-${dname}-${i}`} className="vmManageDrawer-panel">
                  <div className="vmManageDrawer-deviceCardHead">
                    <div className="vmManageDrawer-deviceCardHead-main">
                      <Space size={8} wrap>
                        <CloudInitDrawerHeadIcon
                          aria-hidden
                          style={{
                            fontSize: 22,
                            color: "var(--vm-manage-color-primary)",
                            flexShrink: 0,
                          }}
                        />
                        <span className="vmManageDrawer-deviceCardHead-title">
                          {`Cloud-Init · ${dname}`}
                        </span>
                        <Tag color="warning">未引用 Secret</Tag>
                      </Space>
                    </div>
                  </div>
                  <div className="vmManageDrawer-panel-body">
                    <Typography.Text type="secondary">
                      未指定配置保存在集群的哪一条记录里，无法在此编辑。请在集群侧为卷补全{" "}
                      <Typography.Text code>secretRef</Typography.Text> 后再试。
                    </Typography.Text>
                  </div>
                </div>
              );
            }

            const firstIdx = rows.findIndex(
              (r) => cloudInitSecretRefName(r.vol) === secret,
            );
            if (firstIdx !== i) {
              return null;
            }

            const load = secretByName[secret];
            const draft = draftBySecret[secret];
            const diskNames = secretToDiskNames.get(secret) ?? [dname];

            return (
              <div key={`secret-${secret}`} className="vmManageDrawer-panel">
                <div className="vmManageDrawer-deviceCardHead">
                  <div className="vmManageDrawer-deviceCardHead-main">
                    <Space size={8} wrap>
                      <CloudInitDrawerHeadIcon
                        aria-hidden
                        style={{
                          fontSize: 22,
                          color: "var(--vm-manage-color-primary)",
                          flexShrink: 0,
                        }}
                      />
                      <span className="vmManageDrawer-deviceCardHead-title">
                        {`Cloud-Init · ${diskNames.join("、")}`}
                      </span>
                      <Tag color="blue">Secret</Tag>
                    </Space>
                  </div>
                </div>
                <div className="vmManageDrawer-panel-body">
                  <div className="vmCloudInitManageDrawer-secretMeta">
                    <Typography.Text type="secondary">集群 Secret： </Typography.Text>
                    <Typography.Text code copyable>
                      {secret}
                    </Typography.Text>
                    {vmUid ? (
                      <Typography.Paragraph
                        type="secondary"
                        style={{
                          marginTop: 8,
                          marginBottom: 4,
                          fontSize: 13,
                        }}
                      >
                        虚拟机对象 UID：
                        <Typography.Text code copyable style={{ marginLeft: 6 }}>
                          {vmUid}
                        </Typography.Text>
                      </Typography.Paragraph>
                    ) : null}
                  </div>

                  {load?.loading ? (
                    <Spin tip="正在加载…" />
                  ) : load?.error ? (
                    <Alert type="warning" showIcon message={load.error} />
                  ) : load?.stringData &&
                    Object.keys(load.stringData).length > 0 ? (
                    <>
                      {Object.entries(draft ?? load.stringData)
                        .sort(([a], [b]) =>
                          compareCloudInitSecretKeys(a, b),
                        )
                        .map(([dataKey, text]) => {
                          const { minHeight, maxHeight } =
                            cloudInitSecretKeyEditorSizing(dataKey);
                          return (
                            <div
                              key={dataKey}
                              className="vmCloudInitManageDrawer-keySection"
                            >
                              <Typography.Text
                                strong
                                style={{
                                  fontSize: 13,
                                  display: "block",
                                  marginBottom: 8,
                                }}
                              >
                                {secretDataKeyTitle(dataKey)}
                              </Typography.Text>
                              <CodeEditor
                                value={draft?.[dataKey] ?? text}
                                readOnly={!hasEcsWrite}
                                onChange={(v) =>
                                  updateDraftKey(secret, dataKey, v)
                                }
                                language={guessLangForSecretKey(dataKey)}
                                minHeight={minHeight}
                                maxHeight={maxHeight}
                                style={{ width: "100%" }}
                              />
                            </div>
                          );
                        })}
                    </>
                  ) : (
                    <Typography.Text type="secondary">
                      已找到配置项，但其中没有可读内容（可能尚未写入或为空）。
                    </Typography.Text>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Drawer>
  );
};

export default VmCloudInitDrawer;
