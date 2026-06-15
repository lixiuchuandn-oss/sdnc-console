import React from 'react';
import { Modal } from 'antd';

/** 与删除接口一致：有组织用户则不可删；单框提示，避免「确认删除」后再弹错误 */
export function showTenantDeleteBlockedByOrgUsersModal(
  tenantName: string,
  userCount: number,
) {
  Modal.warning({
    title: '无法删除租户',
    width: 480,
    okText: '知道了',
    content: (
      <div>
        <p style={{ marginBottom: 12 }}>
          租户「{tenantName}」下仍有租户组织用户（共 <strong>{userCount}</strong> 个），无法删除。
        </p>
        <p style={{ marginBottom: 0, color: '#8c8c8c', fontSize: 13 }}>
          请先在「租户组织用户管理」中删除全部租户组织用户后，再删除租户。
        </p>
      </div>
    ),
  });
}

export function showTenantDelete409Modal(errorMessage: string, resources: Array<{ name?: string; count?: number }>) {
  Modal.error({
    title: '无法删除租户',
    width: 500,
    content: (
      <div style={{ marginTop: 16 }}>
        <p style={{ marginBottom: 16, color: '#ff4d4f' }}>{errorMessage}</p>

        {resources.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>关联资源：</div>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {resources.map((r, index) => (
                <li key={index} style={{ marginBottom: 4 }}>
                  {r.name} ({r.count}个)
                </li>
              ))}
            </ul>
          </div>
        )}

        <p style={{ margin: 0, color: '#8c8c8c', fontSize: 12 }}>
          {resources.length > 0
            ? '请先解除上述关联后再删除租户（若包含「邻居」「应用管理」，请到 SDN → 跨域互联处理；资源池/VPC 等请到租户组织管理中解除）。'
            : '请根据页面提示处理后再尝试删除租户。'}
        </p>
      </div>
    ),
  });
}

export type BatchTenantDeleteFailureItem = {
  tenantLabel: string;
  message: string;
  resources: Array<{ name?: string; count?: number }>;
};

/** 批量删除租户：结构化展示每条失败（含 409 关联资源列表） */
export function showBatchTenantDeleteFailuresModal(
  failures: BatchTenantDeleteFailureItem[],
  partialOk: boolean,
) {
  Modal.error({
    title: partialOk ? '部分租户删除失败' : '批量删除租户失败',
    width: 640,
    content: (
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        {failures.map((f, idx) => (
          <div
            key={`${f.tenantLabel}-${idx}`}
            style={{
              marginBottom: 16,
              paddingBottom: 12,
              borderBottom: idx < failures.length - 1 ? '1px solid #f0f0f0' : undefined,
            }}
          >
            <strong>{f.tenantLabel}</strong>
            <p style={{ margin: '8px 0', color: '#ff4d4f' }}>{f.message}</p>
            {f.resources.length > 0 && (
              <>
                <div style={{ marginBottom: 4, fontWeight: 500 }}>关联资源：</div>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {f.resources.map((r, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      {r.name} ({r.count}个)
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ))}
        <p style={{ margin: 0, color: '#8c8c8c', fontSize: 12 }}>
          {failures.some((f) => f.resources.length > 0)
            ? '请先解除上述关联后再删除租户（若包含「邻居」「应用管理」，请到 SDN → 跨域互联处理；资源池/VPC 等请到租户组织管理中解除）。'
            : '请根据页面提示处理后再尝试删除租户。'}
        </p>
      </div>
    ),
  });
}

export function showBatchTenantDeleteBlockedModal(
  items: Array<{ id: string; label: string; n: number }>,
) {
  Modal.warning({
    title: '无法批量删除',
    width: 520,
    okText: '知道了',
    content: (
      <div>
        <p style={{ marginBottom: 12 }}>以下租户仍包含租户组织用户，无法删除（需先删除租户下全部租户组织用户）：</p>
        <ul style={{ margin: '0 0 0 18px', padding: 0 }}>
          {items.map(({ id, label, n }) => (
            <li key={id} style={{ marginBottom: 4 }}>
              「{label}」：{n} 名租户组织用户
            </li>
          ))}
        </ul>
        <p style={{ marginBottom: 0, color: '#8c8c8c', fontSize: 13 }}>请处理后再执行批量删除。</p>
      </div>
    ),
  });
}
