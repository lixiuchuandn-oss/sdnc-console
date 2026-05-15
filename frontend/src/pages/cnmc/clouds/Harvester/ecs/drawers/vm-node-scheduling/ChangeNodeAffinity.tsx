/**
 * ChangeNodeAffinity.tsx
 * 
 * 节点亲和性修改组件
 * 用于编辑 nodeAffinity 配置（如网络标签要求等）
 */
import React, { useEffect } from "react";
import { Form, Segmented, Input, Button, Row, Col, Typography, Select, Card, Space } from "antd";
import { PlusOutlined, MinusCircleOutlined } from "@ant-design/icons";

const NODE_AFFINITY_MODE_DESCRIPTION: Record<"none" | "required", string> = {
  none:
    "不启用节点亲和性时，调度不因本页规则额外约束主机，虚拟机仍受节点选择器、资源与平台其它策略影响。无进阶调度需求时建议保持「未设置」。",

  required:
    "启用后仅调度到符合条件的主机，适用于网络、机房、主机角色等有硬要求的场景：组内需全部满足，多组满足其一即可；标签须与集群一致，可与「节点选择器」叠加。",
};

type Props = {
  form: any;
  cloudId: string;
  record: any;
};

// 表达式行组件（使用 Form.Item shouldUpdate 来监听变化）
const ExpressionRow: React.FC<{
  exprName: number;
  operatorPath: (string | number)[];
  form: any;
  onRemove: () => void;
}> = ({ exprName, operatorPath, form, onRemove }) => {
  return (
    <Form.Item noStyle shouldUpdate={(prevValues, currentValues) => {
      const prevOp = form.getFieldValue(operatorPath);
      const currentOp = form.getFieldValue(operatorPath);
      return prevOp !== currentOp;
    }}>
      {() => {
        const operator = form.getFieldValue(operatorPath);
        const needsValues = operator && !['Exists', 'DoesNotExist'].includes(operator);
        
        return (
          <Row gutter={8} style={{ marginBottom: 8 }}>
            <Col span={9}>
              <Form.Item 
                name={[exprName, 'key']} 
                noStyle 
                rules={[{ required: true, message: '请输入键' }]}
              >
                <Input placeholder="Key (如 network.harvesterhci.io/jiqun)" />
              </Form.Item>
            </Col>
            <Col span={5}>
              <Form.Item 
                name={[exprName, 'operator']} 
                noStyle 
                rules={[{ required: true, message: '请选择操作符' }]}
                initialValue="In"
              >
                <Select style={{ width: '100%' }}>
                  <Select.Option value="In">In</Select.Option>
                  <Select.Option value="NotIn">NotIn</Select.Option>
                  <Select.Option value="Exists">Exists</Select.Option>
                  <Select.Option value="DoesNotExist">DoesNotExist</Select.Option>
                  <Select.Option value="Gt">Gt</Select.Option>
                  <Select.Option value="Lt">Lt</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item 
                name={[exprName, 'values']} 
                noStyle 
                dependencies={operatorPath}
                rules={[
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      const op = getFieldValue(operatorPath);
                      // Exists 和 DoesNotExist 不需要 values
                      if (['Exists', 'DoesNotExist'].includes(op)) {
                        return Promise.resolve();
                      }
                      // 其他操作符需要至少一个值
                      if (!value || (Array.isArray(value) && value.length === 0)) {
                        return Promise.reject(new Error('请输入值'));
                      }
                      return Promise.resolve();
                    },
                  }),
                ]}
              >
                <Select
                  mode="tags"
                  placeholder={needsValues ? "Values (多个值用逗号分隔)" : "此操作符不需要值"}
                  tokenSeparators={[',']}
                  style={{ width: '100%' }}
                  disabled={!needsValues}
                />
              </Form.Item>
            </Col>
            <Col span={2}>
              <Button 
                type="text" 
                danger 
                icon={<MinusCircleOutlined />}
                onClick={onRemove}
              />
            </Col>
          </Row>
        );
      }}
    </Form.Item>
  );
};

const ChangeNodeAffinity: React.FC<Props> = ({ 
  form, 
  cloudId, 
  record
}) => {
  // 从 VM 配置中提取当前的节点亲和性信息
  useEffect(() => {
    if (!record) return;
    
    const nodeAffinity = record?.spec?.template?.spec?.affinity?.nodeAffinity;
    const required = nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution;
    
    if (!required || !required.nodeSelectorTerms || required.nodeSelectorTerms.length === 0) {
      form.setFieldsValue({
        nodeAffinityMode: 'none',
        nodeAffinityTerms: undefined,
      });
      return;
    }
    
    // 提取 nodeSelectorTerms
    const terms = required.nodeSelectorTerms.map((term: any) => {
      const expressions = term.matchExpressions || [];
      return {
        expressions: expressions.map((expr: any) => ({
          key: expr.key || '',
          operator: expr.operator || 'In',
          values: Array.isArray(expr.values) ? expr.values : (expr.values ? [expr.values] : []),
        })),
      };
    });
    
    form.setFieldsValue({
      nodeAffinityMode: 'required',
      nodeAffinityTerms: terms.length > 0 ? terms : undefined,
    });
  }, [record, form]);
  
  const nodeAffinityMode = Form.useWatch("nodeAffinityMode", form);

  const affinityModeForHelp: keyof typeof NODE_AFFINITY_MODE_DESCRIPTION =
    nodeAffinityMode === "required" ? "required" : "none";

  return (
    <Space direction="vertical" size="small" style={{ width: "100%" }}>
      <Form.Item
        name="nodeAffinityMode"
        rules={[{ required: true, message: "请选择节点亲和性模式" }]}
        initialValue="none"
        style={{ marginBottom: 0 }}
      >
        <Segmented
          options={[
            { value: "none", label: "未设置" },
            { value: "required", label: "必须满足" },
          ]}
        />
      </Form.Item>

      <Typography.Paragraph
        type="secondary"
        className="vmManageDrawer-modeHelpText"
        style={{ marginTop: 0, marginBottom: 0 }}
      >
        {NODE_AFFINITY_MODE_DESCRIPTION[affinityModeForHelp]}
      </Typography.Paragraph>

      {nodeAffinityMode === "required" && (
        <div>
          <Form.List name="nodeAffinityTerms">
            {(fields, { add, remove }) => (
              <div>
                {fields.map(({ key, name }, idx) => (
                  <Form.List name={[name, 'expressions']} key={key}>
                    {(exprFields, { add: addExpr, remove: removeExpr }) => (
                      <Card
                        size="small"
                        title={`条件组 #${idx + 1}`}
                        extra={
                          <div style={{ display: 'flex', gap: 4 }}>
                            <Button 
                              type="text" 
                              icon={<PlusOutlined />} 
                              onClick={() => addExpr({ key: '', operator: 'In', values: [] })}
                              size="small"
                            />
                            <Button 
                              type="text" 
                              icon={<MinusCircleOutlined />} 
                              onClick={() => remove(name)} 
                              danger 
                              size="small"
                            />
                          </div>
                        }
                        style={{ marginBottom: 12, border: '1px solid #d9d9d9' }}
                      >
                        <div>
                          {exprFields.map(({ key: exprKey, name: exprName }) => {
                            const operatorPath = ['nodeAffinityTerms', name, 'expressions', exprName, 'operator'];
                            
                            return (
                              <ExpressionRow
                                key={exprKey}
                                exprName={exprName}
                                operatorPath={operatorPath}
                                form={form}
                                onRemove={() => removeExpr(exprName)}
                              />
                            );
                          })}
                        </div>
                      </Card>
                    )}
                  </Form.List>
                ))}
                <Button
                  type="dashed"
                  onClick={() =>
                    add({ expressions: [{ key: "", operator: "In", values: [] }] })
                  }
                  icon={<PlusOutlined />}
                  block
                >
                  新增条件组
                </Button>
              </div>
            )}
          </Form.List>
        </div>
      )}
    </Space>
  );
};

export default ChangeNodeAffinity;
