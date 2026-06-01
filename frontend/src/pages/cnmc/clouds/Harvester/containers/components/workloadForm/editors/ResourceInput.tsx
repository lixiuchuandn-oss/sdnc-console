/**
 * CPU/内存等资源数量 + 单位输入
 */
import React, { useState, useEffect } from 'react';
import { Input, InputNumber, Select, Tooltip } from 'antd';

const ResourceInput: React.FC<{
  value?: string;
  onChange?: (value: string | undefined) => void;
  placeholder?: string;
  units: Array<{ label: string; value: string }>;
  defaultUnit: string;
  unitTooltip?: string;
}> = ({ value, onChange, placeholder, units, defaultUnit, unitTooltip }) => {
  const [num, setNum] = useState<string>('');
  const [unit, setUnit] = useState<string>(defaultUnit);

  useEffect(() => {
    if (!value) {
      setNum('');
      setUnit(defaultUnit);
      return;
    }
    const match = value.match(/^(\d+\.?\d*)(.*)$/);
    if (match) {
      setNum(match[1]);
      const suffix = match[2];
      if (suffix !== undefined && suffix !== '') {
        setUnit(suffix);
      } else {
        if (defaultUnit === 'm') {
          setUnit('');
        } else {
          setUnit(defaultUnit);
        }
      }
    }
  }, [value, defaultUnit]);

  const handleNumChange = (newNum: string) => {
    setNum(newNum);
    if (newNum) {
      onChange?.(newNum + unit);
    } else {
      onChange?.(undefined);
    }
  };

  const handleUnitChange = (newUnit: string) => {
    setUnit(newUnit);
    if (num) {
      onChange?.(num + newUnit);
    }
  };

  return (
    <Input.Group compact style={{ display: 'flex' }}>
      <InputNumber
        value={num ? Number(num) : undefined}
        onChange={(v) => handleNumChange(v ? String(v) : '')}
        placeholder={placeholder}
        min={0}
        step={unit === 'm' ? 100 : 0.5}
        precision={unit === 'm' ? 0 : 2}
        style={{ flex: 1, minWidth: 60 }}
      />
      <Tooltip title={unitTooltip}>
        <Select
          value={unit}
          onChange={handleUnitChange}
          options={units}
          style={{ width: 80 }}
        />
      </Tooltip>
    </Input.Group>
  );
};

export default ResourceInput;
