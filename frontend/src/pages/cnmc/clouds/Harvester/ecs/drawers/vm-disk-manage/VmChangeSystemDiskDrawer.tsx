/**
 * 功能：更换系统镜像（系统盘/根盘镜像切换）。
 * 与资源变配「更换系统镜像」同一套表单与提交逻辑。
 * 样式仅依赖 `drawers/shared/styles/vmManageDrawer.css` + `useVmManageDrawerCssVars`，无单独样式文件。
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Flex,
  Form,
  message,
  Modal,
} from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import {
  fetchHarvesterImages,
  fetchHarvesterStorageClasses,
} from "../../../../../../../services/harvesterApi";
import { rebootCloudProviderEcs } from "../../../../../../../services/api";
import { translateKnownApiErrorMessage } from "../../../../../../../utils/k8sErrorMessages";
import ChangeOs from "./ChangeOs";
import { initChangeOsMenu } from "./lib/initChangeOsMenu";
import type { VmReconfigureMenuInitCtx } from "../../lib/vmMutation/vmReconfigureMenuInitContext";
import { submitVmReconfigureChangeOs } from "./lib/submitChangeOs";
import type { VmReconfigureSubmitCtx } from "../../lib/vmMutation/vmReconfigureSubmitContext";
import { VmReconfigureSubmitSkipFinalize } from "../../lib/vmMutation/vmReconfigureSubmitTypes";
import { getVmRootImageIdFromVm } from "../../lib/vmImageStatus";
import {
  getVmChangeSystemDiskEligibility,
  resolveVmBootDiskDevice,
} from "../../lib/vmChangeSystemDiskEligibility";
import { showChangeOsRiskModal } from "../../lib/showChangeOsRiskModal";
import { isVmStopped } from "../../lib/vmInstanceStatus";
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import "../shared/styles/vmManageDrawer.css";

export interface VmChangeSystemDiskDrawerProps {
  open: boolean;
  onClose: () => void;
  vmData: any;
  cloudId: string;
  hasEcsWrite: boolean;
  onApplied: () => void | Promise<void>;
}

function getSystemDiskPvcFromVm(activeRecord: any, record: any): string {
  const bootDisk = resolveVmBootDiskDevice(activeRecord);
  if (!bootDisk) return record?.volumeClaims?.[0] || "";
  const volumes = activeRecord?.spec?.template?.spec?.volumes || [];
  const volume = volumes.find((v: any) => v.name === bootDisk.name);
  if (volume?.persistentVolumeClaim?.claimName) {
    return volume.persistentVolumeClaim.claimName;
  }
  return record?.volumeClaims?.[0] || "";
}

const VmChangeSystemDiskDrawer: React.FC<VmChangeSystemDiskDrawerProps> = ({
  open,
  onClose,
  vmData,
  cloudId,
  hasEcsWrite,
  onApplied,
}) => {
  const vmManageCssVars = useVmManageDrawerCssVars();
  const [form] = Form.useForm();
  const [latestVm, setLatestVm] = useState<any>(null);
  const [scs, setScs] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const initOnceRef = useRef(false);

  const record = vmData;
  const activeRecord = latestVm || record;

  const changeOsConfirmed = Form.useWatch("changeOsConfirmed", form);

  const changeOsEligibility = useMemo(
    () => getVmChangeSystemDiskEligibility(vmData),
    [vmData],
  );

  const isHotPlugInProgress = useMemo(() => {
    const conditions = vmData?.status?.conditions || [];
    return conditions.some(
      (c: any) =>
        (c.type === "HotVCPUChange" || c.type === "HotMemoryChange") &&
        c.status === "True",
    );
  }, [vmData]);

  const architecture =
    record?.spec?.template?.spec?.architecture || record?.spec?.architecture;
  const isArm64Vm = useMemo(
    () => String(architecture || "").toLowerCase().includes("arm"),
    [architecture],
  );

  const currentOsImageId = useMemo(() => {
    const rid = getVmRootImageIdFromVm(activeRecord);
    return String(rid || "").trim() || undefined;
  }, [activeRecord]);

  const currentOsImageResolvedLabel = useMemo(() => {
    const id = currentOsImageId || "";
    if (!id) return "";
    const hit = (images || []).find((x: any) => {
      const name = x?.metadata?.name || x?.name;
      const ns = x?.metadata?.namespace || x?.namespace;
      const v = ns && name ? `${ns}/${name}` : name;
      return v === id;
    });
    if (!hit) return id;
    const ann = hit?.metadata?.annotations || {};
    return String(
      hit?.spec?.displayName ||
        ann["field.cattle.io/displayName"] ||
        ann["harvesterhci.io/image-name"] ||
        hit?.metadata?.name ||
        id,
    );
  }, [currentOsImageId, images]);

  const defaultStorageClassName = useMemo(() => {
    const d = (scs || []).find(
      (x) =>
        x?.metadata?.annotations?.["storageclass.kubernetes.io/is-default-class"] ===
        "true",
    );
    return d?.metadata?.name;
  }, [scs]);

  const reloadScs = useCallback(async () => {
    try {
      const res = await fetchHarvesterStorageClasses(cloudId);
      const items = Array.isArray(res?.data?.items)
        ? res.data.items
        : Array.isArray(res?.items)
          ? res.items
          : [];
      setScs(items);
    } catch {
      /* ignore */
    }
  }, [cloudId]);

  const reloadImages = useCallback(async () => {
    try {
      const res = await fetchHarvesterImages(cloudId);
      const items = Array.isArray(res?.data?.items)
        ? res.data.items
        : Array.isArray(res?.items)
          ? res.items
          : [];
      setImages(items);
      return items;
    } catch {
      return [];
    }
  }, [cloudId]);

  const openRestartConfirm = useCallback(
    (
      namespace: string,
      vmName: string,
      force: boolean = false,
      options?: { cdrom?: boolean },
    ) => {
      const activeVm = latestVm || record;
      if (isVmStopped(activeVm)) {
        if (options?.cdrom) {
          Modal.info({
            title: "光盘配置已保存",
            content:
              "当前虚拟机已关机，规格已写入。添加/挂载光盘后必须重启才能生效：请先启动虚拟机，再执行一次重启（或关机再开），否则光驱可能不可用。",
            okText: "知道了",
          });
          return;
        }
        message.success("设置已保存，下次启动时将自动应用新配置");
        return;
      }

      Modal.confirm({
        title: options?.cdrom
          ? "光盘已挂入规格：必须重启虚拟机后生效，是否立即重启"
          : "规格变更已提交，需要重启实例生效，是否重启实例",
        okText: "立即重启",
        cancelText: "手动重启",
        onOk: async () => {
          try {
            await rebootCloudProviderEcs(
              cloudId,
              `${namespace}/${vmName}`,
              force,
            );
            message.success("重启指令已下发");
          } catch (e: any) {
            message.error(
              translateKnownApiErrorMessage(
                String(e?.message || e || "重启失败"),
              ),
            );
          }
        },
        onCancel: () => {},
      });
    },
    [cloudId, latestVm, record],
  );

  useEffect(() => {
    if (!open) {
      initOnceRef.current = false;
      return;
    }
    if (!vmData || !cloudId) return;
    if (!getVmChangeSystemDiskEligibility(vmData).allowed) return;
    if (initOnceRef.current) return;
    initOnceRef.current = true;
    setLatestVm(vmData);
    form.resetFields();

    void (async () => {
      const [scsRes, imgItems] = await Promise.all([
        fetchHarvesterStorageClasses(cloudId).then((res) => {
          const items = Array.isArray(res?.data?.items)
            ? res.data.items
            : Array.isArray(res?.items)
              ? res.items
              : [];
          setScs(items);
          return items;
        }),
        fetchHarvesterImages(cloudId).then((res) => {
          const items = Array.isArray(res?.data?.items)
            ? res.data.items
            : Array.isArray(res?.items)
              ? res.items
              : [];
          setImages(items);
          return items;
        }),
      ]);

      const systemDisk = getSystemDiskPvcFromVm(vmData, vmData);
      initChangeOsMenu({
        form,
        activeRecord: vmData,
        record: vmData,
        images: imgItems,
        scs: scsRes,
        systemDisk,
        cloudId,
        reloadImages: async () => {
          await reloadImages();
        },
        reloadScs: async () => {
          await reloadScs();
        },
        latestVm: null,
        open: true,
        gpuResources: [],
        usbResources: [],
        nodes: [],
        getCurrentSpec: () => ({}),
        getMemoryInGi: () => 0,
        reloadGpuResources: async () => {},
        reloadUsbResources: async () => {},
        reloadNodes: async () => {},
        setSelectedUsbKeys: () => {},
      } satisfies VmReconfigureMenuInitCtx);
      form.setFieldsValue({ changeOsConfirmed: false });
    })();
  }, [open, vmData, cloudId, form, reloadScs]);

  const handleSubmit = async () => {
    if (!changeOsEligibility.allowed) {
      message.warning(changeOsEligibility.message);
      return;
    }
    const vmName = String(record?.metadata?.name || "").trim();
    const ns = String(record?.metadata?.namespace || "").trim();
    if (!vmName || !ns) return;
    setSubmitting(true);
    try {
      const values = await form.validateFields();
      await submitVmReconfigureChangeOs(
        { cloudId, openRestartConfirm } as VmReconfigureSubmitCtx,
        values,
        vmName,
        ns,
      );
      await onApplied();
      onClose();
    } catch (e: any) {
      if (
        e instanceof VmReconfigureSubmitSkipFinalize ||
        e?.name === "VmReconfigureSubmitSkipFinalize"
      ) {
        return;
      }
      if (e?.errorFields) return;
      console.error(e);
      message.error(String(e?.message || e || "操作失败"));
    } finally {
      setSubmitting(false);
    }
  };

  const footerDisabled =
    !hasEcsWrite || isHotPlugInProgress || !changeOsEligibility.allowed;
  const onShowChangeOsRisk = useCallback(
    () => showChangeOsRiskModal(form),
    [form],
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      closable={false}
      width={800}
      placement="right"
      forceRender
      push={{ distance: 180 }}
      styles={{
        header: { display: "none" },
        body: { padding: 24 },
      }}
      footer={
        <Flex
          wrap="wrap"
          gap="small"
          justify="flex-end"
          align="center"
          style={{ width: "100%" }}
        >
          <Checkbox
            className="vmManageDrawer-drawerFooterCheckbox"
            checked={!!changeOsConfirmed}
            disabled
          >
            已确认风险
          </Checkbox>
          <Button
            type="link"
            onClick={onShowChangeOsRisk}
            style={{ paddingLeft: 0 }}
            disabled={!changeOsEligibility.allowed}
          >
            查看风险信息
          </Button>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            onClick={() => void handleSubmit()}
            loading={submitting}
            disabled={footerDisabled || !changeOsConfirmed}
          >
            提交
          </Button>
        </Flex>
      }
    >
      <div className="vmManageDrawer" style={vmManageCssVars}>
        {!changeOsEligibility.allowed ? (
          <Alert
            className="vmManageDrawer-stackGap"
            type="warning"
            showIcon
            message="当前无法更换系统镜像"
            description={changeOsEligibility.message}
          />
        ) : null}
        {isHotPlugInProgress ? (
          <Alert
            className="vmManageDrawer-stackGap"
            type="warning"
            showIcon
            icon={<LoadingOutlined />}
            message="热扩容进行中"
            description="CPU 或内存热扩容完成前，请避免更换系统盘，以免并发失败。"
          />
        ) : null}

        {changeOsEligibility.allowed ? (
          <Form
            form={form}
            layout="horizontal"
            labelAlign="left"
            labelCol={{ span: 6 }}
            wrapperCol={{ span: 18 }}
          >
            <ChangeOs
              form={form}
              images={images}
              reloadImages={reloadImages}
              storageClasses={scs}
              reloadStorageClasses={reloadScs}
              defaultStorageClassName={defaultStorageClassName}
              currentOsImageId={currentOsImageId}
              currentOsImageLabel={currentOsImageResolvedLabel || undefined}
              isArm64={isArm64Vm}
            />
          </Form>
        ) : null}
      </div>
    </Drawer>
  );
};

export default VmChangeSystemDiskDrawer;
