import type { ComponentType, CSSProperties } from 'react';
import {
  CheckCircleTwoTone,
  CloudTwoTone,
  ControlTwoTone,
  EnvironmentTwoTone,
  AppstoreTwoTone,
  HddTwoTone,
  PlayCircleTwoTone,
  WarningTwoTone,
} from '@ant-design/icons';

/** 概览统计卡双色图标（@ant-design/icons TwoTone） */
export type MaasDashTwoToneIcon = ComponentType<{
  style?: CSSProperties;
  className?: string;
  twoToneColor?: string | [string, string];
}>;

export const MaasDashStatIcon = {
  region: ControlTwoTone,
  rack: CloudTwoTone,
  machines: HddTwoTone,
  ready: CheckCircleTwoTone,
  deployed: PlayCircleTwoTone,
  error: WarningTwoTone,
  discoveries: EnvironmentTwoTone,
  images: AppstoreTwoTone,
} as const satisfies Record<string, MaasDashTwoToneIcon>;
