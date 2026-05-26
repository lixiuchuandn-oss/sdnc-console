/**
 * ==============================================================================
 * 模块名称: Cron 表达式解析助手 (CronExpressionHelper)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/CronExpressionHelper.tsx
 * ==============================================================================
 *
 * [功能描述]
 * 解析 Cron 表达式并显示中文含义、最近执行时间
 * 帮助用户验证表达式是否符合预期
 */

import React, { useMemo } from 'react';
import { Alert, Tag, List, Typography, Space } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { CronExpressionParser } from 'cron-parser';

const { Text } = Typography;

interface CronExpressionHelperProps {
  expression: string;
}

/**
 * Cron 宏表达式映射
 */
const CRON_MACROS: Record<string, { expression: string; label: string }> = {
  '@yearly': { expression: '0 0 1 1 *', label: '每年一次（1月1日）' },
  '@annually': { expression: '0 0 1 1 *', label: '每年一次（1月1日）' },
  '@monthly': { expression: '0 0 1 * *', label: '每月一次（每月1日）' },
  '@weekly': { expression: '0 0 * * 0', label: '每周一次（周日）' },
  '@daily': { expression: '0 0 * * *', label: '每天一次（午夜）' },
  '@midnight': { expression: '0 0 * * *', label: '每天一次（午夜）' },
  '@hourly': { expression: '0 * * * *', label: '每小时一次' },
};

/**
 * 检查是否为宏表达式
 */
const isMacro = (expression: string): boolean => {
  return Object.keys(CRON_MACROS).includes(expression.trim().toLowerCase());
};

/**
 * 获取宏表达式的中文说明
 */
const getMacroInfo = (expression: string): { expression: string; label: string } | null => {
  return CRON_MACROS[expression.trim().toLowerCase()] || null;
};

/**
 * 解析周的表达式为中文
 * 支持: 单个数字(1)、范围(1-5)、列表(1,3,5)、步长(星号/2)
 */
const parseDayOfWeekToChinese = (dayOfWeek: string): string => {
  const weekDays: Record<string, string> = {
    '0': '周日',
    '1': '周一',
    '2': '周二',
    '3': '周三',
    '4': '周四',
    '5': '周五',
    '6': '周六',
  };

  // 步长表达式 (如 */2, 1-5/2)
  if (dayOfWeek.includes('/')) {
    const [range, step] = dayOfWeek.split('/');
    const rangeText = parseDayOfWeekToChinese(range);
    return `${rangeText} (每隔 ${step} 天)`;
  }

  // 列表表达式 (如 1,3,5)
  if (dayOfWeek.includes(',')) {
    const days = dayOfWeek.split(',');
    const dayNames = days.map(d => weekDays[d.trim()] || `周${d.trim()}`);
    return dayNames.join('、');
  }

  // 范围表达式 (如 1-5)
  if (dayOfWeek.includes('-')) {
    const [start, end] = dayOfWeek.split('-');
    const startDay = weekDays[start.trim()] || `周${start.trim()}`;
    const endDay = weekDays[end.trim()] || `周${end.trim()}`;
    return `${startDay}至${endDay}`;
  }

  // 单个数字
  return weekDays[dayOfWeek] || `周${dayOfWeek}`;
};

/**
 * 解析 Cron 表达式为中文描述
 */
export const parseToChinese = (expression: string): string => {
  // 检查是否为宏表达式
  const macroInfo = getMacroInfo(expression);
  if (macroInfo) {
    return macroInfo.label;
  }

  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return '';
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // 每秒执行（不支持，但友好提示）
  if (minute === '*') {
    return '每分钟执行一次';
  }

  // 每小时执行
  if (minute !== '*' && hour === '*') {
    return `每小时的第 ${minute} 分钟执行`;
  }

  // 每天执行
  if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && dayOfWeek === '*') {
    return `每天 ${hour}:${minute.padStart(2, '0')} 执行`;
  }

  // 每周执行
  if (dayOfWeek !== '*') {
    const weekDay = parseDayOfWeekToChinese(dayOfWeek);
    return `每周${weekDay} ${hour}:${minute.padStart(2, '0')} 执行`;
  }

  // 每月执行
  if (dayOfMonth !== '*') {
    return `每月 ${dayOfMonth} 日 ${hour}:${minute.padStart(2, '0')} 执行`;
  }

  return '';
};

/**
 * 获取最近几次执行时间
 * 支持标准格式和宏表达式
 */
const getNextExecutionTimes = (expression: string, count: number = 5): Date[] => {
  try {
    const trimmedExpr = expression.trim();
    // 如果是宏表达式，转换为实际表达式
    const actualExpr = getMacroInfo(trimmedExpr)?.expression || trimmedExpr;

    const interval = CronExpressionParser.parse(actualExpr, {
      tz: 'Asia/Shanghai',
    });
    const times: Date[] = [];
    for (let i = 0; i < count; i++) {
      times.push(interval.next().toDate());
    }
    return times;
  } catch {
    return [];
  }
};

/**
 * 验证 Cron 表达式是否有效
 * 支持标准 5 字段格式和宏表达式
 */
const validateCronExpression = (expression: string): { valid: boolean; error?: string } => {
  if (!expression || expression.trim() === '') {
    return { valid: false, error: '表达式不能为空' };
  }

  const trimmedExpr = expression.trim();

  // 检查是否为宏表达式
  if (isMacro(trimmedExpr)) {
    return { valid: true };
  }

  const parts = trimmedExpr.split(/\s+/);
  if (parts.length !== 5) {
    return { valid: false, error: `表达式需要 5 个字段（分 时 日 月 周），当前 ${parts.length} 个` };
  }

  try {
    CronExpressionParser.parse(expression);
    return { valid: true };
  } catch (e: any) {
    return { valid: false, error: e.message || '表达式格式错误' };
  }
};

const CronExpressionHelper: React.FC<CronExpressionHelperProps> = ({ expression }) => {
  const validation = useMemo(() => validateCronExpression(expression), [expression]);
  const chineseDesc = useMemo(() => parseToChinese(expression), [expression]);
  const nextTimes = useMemo(() => getNextExecutionTimes(expression), [expression]);
  const macroInfo = useMemo(() => getMacroInfo(expression), [expression]);
  const isMacroExpr = useMemo(() => isMacro(expression), [expression]);

  if (!expression || expression.trim() === '') {
    return (
      <Alert
        message="Cron 表达式格式"
        description={
          <div style={{ fontSize: 12 }}>
            <code>分(0-59) 时(0-23) 日(1-31) 月(1-12) 周(0-6)</code>
            <div style={{ marginTop: 4, color: '#666' }}>
              周：0=周日, 1=周一, 2=周二, 3=周三, 4=周四, 5=周五, 6=周六
            </div>
            <div style={{ marginTop: 4, color: '#666' }}>
              示例：0 2 * * 1 = 每周一凌晨2点执行
            </div>
          </div>
        }
        type="info"
        showIcon
      />
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      {validation.valid ? (
        <Alert
          message={
            <Space>
              <CheckCircleOutlined style={{ color: '#52c41a' }} />
              <Text strong>表达式有效</Text>
            </Space>
          }
          description={
            <div>
              {/* 宏表达式显示实际表达式 */}
              {isMacroExpr && macroInfo && (
                <div style={{ marginBottom: 8 }}>
                  <Tag color="orange">宏表达式</Tag>
                  <Text type="secondary"> 实际表达式：</Text>
                  <code>{macroInfo.expression}</code>
                </div>
              )}
              {chineseDesc && (
                <div style={{ marginBottom: 8 }}>
                  <Text type="secondary">含义：</Text>
                  <Tag color="blue">{chineseDesc}</Tag>
                </div>
              )}
              <div>
                <Text type="secondary">
                  <ClockCircleOutlined /> 最近 5 次执行时间：
                </Text>
                <List
                  size="small"
                  dataSource={nextTimes}
                  renderItem={(time) => (
                    <List.Item style={{ padding: '4px 0' }}>
                      <Text>{time.toLocaleString('zh-CN')}</Text>
                    </List.Item>
                  )}
                />
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: '#888', borderTop: '1px dashed #d9d9d9', paddingTop: 8 }}>
                格式：分(0-59) 时(0-23) 日(1-31) 月(1-12) 周(0-6, 0=周日)
              </div>
            </div>
          }
          type="success"
          showIcon={false}
        />
      ) : (
        <Alert
          message={
            <Space>
              <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
              <Text strong>表达式无效</Text>
            </Space>
          }
          description={
            <div>
              <div>{validation.error}</div>
              <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
                格式：分(0-59) 时(0-23) 日(1-31) 月(1-12) 周(0-6, 0=周日)
              </div>
            </div>
          }
          type="error"
          showIcon={false}
        />
      )}
    </div>
  );
};

export default CronExpressionHelper;
