import React from 'react';
import { Button, Dropdown, MenuProps, Tooltip } from 'antd';
import { EllipsisOutlined } from '@ant-design/icons';

export type ResourceActionItem = {
  key: string;
  label?: React.ReactNode;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  tooltip?: React.ReactNode;
  onClick?: () => void;
  show?: boolean;
  type?: 'divider';
  [key: string]: any;
};

type Props = {
  items?: any[];
  /** 与 antd Dropdown `menu.onClick` 一致，含 `domEvent`；勿只传 `{ key }` 以免调用方 `stopPropagation` 报错 */
  onClick?: MenuProps['onClick'];
  buttonProps?: any;
  menuProps?: MenuProps;
  dropdownProps?: any;
  buttonType?: 'default' | 'link' | 'text';
  icon?: React.ReactNode;
  size?: 'small' | 'middle' | 'large';
  children?: React.ReactNode;
};

const ResourceActionsDropdown: React.FC<Props> = ({
  items,
  onClick,
  buttonProps,
  menuProps,
  dropdownProps,
  buttonType = 'text',
  icon,
  size,
  children,
}) => {
  const processedItems: MenuProps['items'] = React.useMemo(() => {
    if (!items) return [];
    return items.map((item) => {
      if (!item || typeof item !== 'object') return item;
      if (item.type === 'divider') {
        return { type: 'divider' as const, key: item.key };
      }
      
      const { tooltip, show: _show, onClick: itemOnClick, disabled, danger, ...rest } = item;
      
      if (disabled) {
        return {
          key: rest.key,
          icon: rest.icon,
          label: tooltip ? (
            <Tooltip title={tooltip} placement="left">
              <span style={{ color: 'rgba(0, 0, 0, 0.25)' }}>{item.label}</span>
            </Tooltip>
          ) : (
            <span style={{ color: 'rgba(0, 0, 0, 0.25)' }}>{item.label}</span>
          ),
          disabled: true,
        };
      }
      
      return {
        key: rest.key,
        icon: rest.icon,
        label: item.label,
        danger: danger,
        onClick: itemOnClick,
      };
    });
  }, [items]);

  if (!processedItems?.length) {
    return null;
  }

  const finalMenu: MenuProps = menuProps || {
    items: processedItems,
    onClick: (info) => {
      if (onClick) onClick(info);
    },
  };
  return (
    <Dropdown menu={finalMenu} trigger={['click']} {...dropdownProps}>
      {children ? (
        <span {...buttonProps}>{children}</span>
      ) : (
        <Button
          type={buttonType}
          icon={icon ?? <EllipsisOutlined />}
          size={size}
          {...buttonProps}
        />
      )}
    </Dropdown>
  );
};

export default ResourceActionsDropdown;
