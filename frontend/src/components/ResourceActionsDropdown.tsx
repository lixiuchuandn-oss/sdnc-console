import React from 'react';
import { Button, Dropdown, MenuProps } from 'antd';
import { EllipsisOutlined } from '@ant-design/icons';

type Props = {
  items: MenuProps['items'];
  onClick?: (info: { key: string }) => void;
  buttonProps?: any;
};

const ResourceActionsDropdown: React.FC<Props> = ({ items, onClick, buttonProps }) => {
  return (
    <Dropdown
      menu={{
        items,
        onClick: ({ key }) => {
          if (onClick) onClick({ key });
        },
      }}
      trigger={['click']}
    >
      <Button type="default" icon={<EllipsisOutlined />} {...buttonProps} />
    </Dropdown>
  );
};

export default ResourceActionsDropdown;
