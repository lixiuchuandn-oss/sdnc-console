/**
 * 高可用设置 · 运行策略 + 驱逐策略表单区（仅被同域 `VmVmPolicyDrawer` 使用；提交见 `./lib/submitVmPolicy`）。
 */
import React from "react";
import { Col, Form, Row, Select, message } from "antd";

export function VmPolicyFormBody() {
  return (
    <div>
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: "32px" }}>运行策略</div>
        </Col>
        <Col span={18}>
          <Form.Item
            name="runStrategy"
            rules={[{ required: true, message: "请选择运行策略" }]}
            noStyle
          >
            <Select
              placeholder="选择运行策略"
              style={{ width: 320 }}
              options={[
                { value: "Always", label: "Always（始终运行）" },
                { value: "RerunOnFailure", label: "RerunOnFailure（失败自动重启）" },
                { value: "Manual", label: "Manual（手动控制）" },
                { value: "Halted", label: "Halted（保持停止）" },
              ]}
              onChange={(v) => {
                if (String(v) === "Halted")
                  message.warning("设置为 Halted 后实例将保持停止状态");
              }}
            />
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: "32px" }}>驱逐策略</div>
        </Col>
        <Col span={18}>
          <Form.Item name="evictionStrategy" noStyle>
            <Select
              placeholder="选择驱逐策略"
              allowClear
              style={{ width: 320 }}
              options={[
                {
                  value: "LiveMigrateIfPossible",
                  label: "LiveMigrateIfPossible（尽可能热迁移）",
                },
                { value: "LiveMigrate", label: "LiveMigrate（强制热迁移）" },
                { value: "None", label: "None（不迁移）" },
              ]}
              onChange={(v) => {
                if (String(v) === "None")
                  message.warning(
                    "驱逐策略为 None 时，节点维护/驱逐可能导致实例不可用",
                  );
              }}
            />
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>
    </div>
  );
}
