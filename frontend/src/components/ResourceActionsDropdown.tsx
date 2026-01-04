import React from 'react';
import { Button, Dropdown, MenuProps } from 'antd';
import { EllipsisOutlined } from '@ant-design/icons';

type Props = {
  items?: MenuProps['items'];
  onClick?: (info: { key: string }) => void;
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
  const finalMenu: MenuProps = menuProps || {
    items,
    onClick: ({ key }) => {
      if (onClick) onClick({ key });
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
