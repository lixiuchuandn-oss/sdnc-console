import React from 'react';

export type DeleteOrgConflictProps = {
  errorMessage: string;
  resources: Array<{ name?: string; count?: number }>;
};

/** 删除组织失败（409）时关联资源列表展示 */
export function DeleteOrgConflict({ errorMessage, resources }: DeleteOrgConflictProps) {
  return (
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
        请先解除上述资源绑定后再尝试删除组织。
      </p>
    </div>
  );
}
