import type { ComponentType, CSSProperties } from 'react';
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  CloudOutlined,
  ControlOutlined,
  EnvironmentOutlined,
  HddOutlined,
  PlayCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';

/** 概览统计卡图标（统一单色 Outlined，与阿里云/华为云/Xinference 总览一致） */
export type MaasDashStatIconComp = ComponentType<{
  style?: CSSProperties;
  className?: string;
}>;

export const MaasDashStatIcon = {
  region: ControlOutlined,
  rack: CloudOutlined,
  machines: HddOutlined,
  ready: CheckCircleOutlined,
  deployed: PlayCircleOutlined,
  error: WarningOutlined,
  discoveries: EnvironmentOutlined,
  images: AppstoreOutlined,
} as const satisfies Record<string, MaasDashStatIconComp>;
