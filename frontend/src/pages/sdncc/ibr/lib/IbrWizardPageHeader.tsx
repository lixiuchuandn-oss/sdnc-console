import React from 'react';
import { Breadcrumb, Button, Space, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePageRouteMeta } from '../../../../components/pageRouteMeta/routeMeta';
import type { PageRouteCrumb } from '../../../../components/pageRouteMeta/routeMeta';

export type IbrWizardPageHeaderProps = {
  /** 缺省取路由 meta title */
  title?: React.ReactNode;
  /** 一行简短说明（可选） */
  subtitle?: React.ReactNode;
  /** 标题旁资源标识，如 VR 名称 / uuid 短码 */
  meta?: React.ReactNode;
  /** 右侧动作（刷新等），与「返回」同一组靠右 */
  extra?: React.ReactNode;
  /** 默认 navigate(-1)；传 false 不显示返回 */
  onBack?: (() => void) | false;
  /** 是否展示面包屑，默认 true */
  showBreadcrumb?: boolean;
  /** 底部分割线，默认 true；架构拓扑等全幅内容页可关 */
  bordered?: boolean;
  style?: React.CSSProperties;
};

/**
 * IBR 向导页顶栏：面包屑 + 标题行（左标题/meta，右统一按钮）+ 可选副标题。
 */
const IbrWizardPageHeader: React.FC<IbrWizardPageHeaderProps> = ({
  title,
  subtitle,
  meta,
  extra,
  onBack,
  showBreadcrumb = true,
  bordered = true,
  style,
}) => {
  const navigate = useNavigate();
  const loc = useLocation();
  const { autoCrumbs, displayTitle, displaySubtitle } = usePageRouteMeta(loc.pathname, {
    title,
    subtitle,
  });

  const handleBack =
    onBack === false
      ? undefined
      : onBack ||
        (() => {
          navigate(-1);
        });

  const resolvedSubtitle = subtitle !== undefined ? subtitle : displaySubtitle;
  const hasActions = !!handleBack || !!extra;

  return (
    <header
      className={['ibr-wizard-page-header', bordered ? 'ibr-wizard-page-header--bordered' : '']
        .filter(Boolean)
        .join(' ')}
      style={style}
    >
      {showBreadcrumb && autoCrumbs.length > 0 ? (
        <Breadcrumb
          className="ibr-wizard-page-header__crumbs"
          items={autoCrumbs.map((item: PageRouteCrumb) => ({ title: item.label, href: item.href }))}
        />
      ) : null}

      <div className="ibr-wizard-page-header__row">
        <div className="ibr-wizard-page-header__title-row">
          <Typography.Title level={4} className="ibr-wizard-page-header__title">
            {displayTitle}
          </Typography.Title>
          {meta ? (
            <Typography.Text type="secondary" className="ibr-wizard-page-header__meta" ellipsis>
              {meta}
            </Typography.Text>
          ) : null}
        </div>
        {hasActions ? (
          <Space wrap size={8} className="ibr-wizard-page-header__actions" align="center">
            {handleBack ? (
              <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>
                返回
              </Button>
            ) : null}
            {extra}
          </Space>
        ) : null}
      </div>

      {resolvedSubtitle ? (
        <Typography.Text type="secondary" className="ibr-wizard-page-header__subtitle">
          {resolvedSubtitle}
        </Typography.Text>
      ) : null}
    </header>
  );
};

export default IbrWizardPageHeader;
