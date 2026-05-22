/**
 * Underlay/VPC 子网列表等处：独立于详情抽屉的子网 ACL 编辑抽屉。
 */
import React, { useCallback, useEffect, useState } from 'react';
import type { FormInstance } from 'antd/es/form';
import { Button, Drawer, Form, Space, message } from 'antd';
import { updateKubeOvnSubnet } from '../../../../../../../services/harvesterApi';
import SubnetAclFormItems, {
  normalizeAclRowForForm,
  validateAclsFormRowsForSubmit,
} from '../../lib/SubnetAclFormItems';

export type SubnetAclEditDrawerProps = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  subnet: any | null;
  canSubmit: boolean;
  /** 保存成功后（关闭抽屉前由父级刷新列表） */
  onSuccess?: () => void | Promise<void>;
  /**
   * 保存失败后刷新父级数据源并返回该 Subnet CR 的最新对象（至少用于回填 spec.acls）。
   */
  reloadSubnetRecord: (subnetName: string) => Promise<any | null>;
};

const ACL_FORM_ID = 'harvester-underlay-subnet-acl-drawer-form';

function applyAclsToForm(form: FormInstance, subnet: any) {
  const spec = subnet?.spec || {};
  form.setFieldsValue({
    acls: Array.isArray(spec.acls) ? spec.acls.map((a: any) => normalizeAclRowForForm({ ...a })) : [],
  });
}

const SubnetAclEditDrawer: React.FC<SubnetAclEditDrawerProps> = ({
  open,
  onClose,
  cloudId,
  subnet,
  canSubmit,
  onSuccess,
  reloadSubnetRecord,
}) => {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const subnetName = String(subnet?.metadata?.name ?? '').trim();

  useEffect(() => {
    if (!open || !subnet) return;
    applyAclsToForm(form, subnet);
  }, [open, subnet, form]);

  useEffect(() => {
    if (!open) {
      form.resetFields();
      setSubmitting(false);
    }
  }, [open, form]);

  const syncFormFromSubnet = useCallback(
    (rec: any) => {
      if (!rec) return;
      applyAclsToForm(form, rec);
    },
    [form],
  );

  const handleFinish = useCallback(
    async (values: any) => {
      if (!canSubmit) {
        message.error('当前账号没有子网操作权限（租户角色仅允许查看）');
        return;
      }
      if (!subnetName || !cloudId) return;

      try {
        const patchBody: Record<string, unknown> = {};
        if (Array.isArray(values.acls)) {
          const aclCheck = validateAclsFormRowsForSubmit(values.acls);
          if (!aclCheck.ok) {
            message.error(aclCheck.message);
            return;
          }
          patchBody.acls = aclCheck.normalized;
        }
        setSubmitting(true);
        await updateKubeOvnSubnet(cloudId, subnetName, patchBody);
        message.success('ACL 已更新');
        form.resetFields();
        onClose();
        await onSuccess?.();
      } catch (e: any) {
        if (e?.errorFields) return;
        const rd = e?.responseData;
        let detail = String(e?.message || '').trim() || '未知错误';
        if (rd?.details != null) {
          const ds = typeof rd.details === 'string' ? rd.details : JSON.stringify(rd.details);
          const head = ds.slice(0, 48);
          if (head && !detail.includes(head)) {
            const more = ds.length > 400 ? `${ds.slice(0, 400)}…` : ds;
            detail = `${detail} | ${more}`;
          }
        }
        message.error(`更新 ACL 失败: ${detail}`);
        const fresh = await reloadSubnetRecord(subnetName);
        syncFormFromSubnet(fresh);
      } finally {
        setSubmitting(false);
      }
    },
    [
      canSubmit,
      subnetName,
      cloudId,
      form,
      onClose,
      onSuccess,
      reloadSubnetRecord,
      syncFormFromSubnet,
    ],
  );

  return (
    <Drawer
      title="编辑 ACL"
      width="min(1100px, 96vw)"
      open={open && !!subnet}
      onClose={onClose}
      destroyOnHidden
      styles={{
        body: { paddingBottom: 8 },
      }}
      footer={
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            onClick={() => {
              form.resetFields();
              onClose();
            }}
          >
            取消
          </Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={!canSubmit}
            htmlType="submit"
            form={ACL_FORM_ID}
          >
            保存
          </Button>
        </Space>
      }
    >
      <Form
        id={ACL_FORM_ID}
        form={form}
        layout="vertical"
        className="std-form"
        disabled={submitting || !canSubmit}
        onFinish={handleFinish}
      >
        <SubnetAclFormItems />
      </Form>
    </Drawer>
  );
};

export default SubnetAclEditDrawer;
