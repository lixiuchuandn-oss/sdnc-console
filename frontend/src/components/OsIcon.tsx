import React from 'react';
import Icon from '@ant-design/icons';
import { ReactComponent as AndroidSvg } from '../assets/OS/android.svg';
import { ReactComponent as AnolisSvg } from '../assets/OS/anolis.svg';
import { ReactComponent as CentosSvg } from '../assets/OS/centos.svg';
import { ReactComponent as DebianSvg } from '../assets/OS/debian.svg';
import { ReactComponent as FedoraSvg } from '../assets/OS/fedora.svg';
import { ReactComponent as FreebsdSvg } from '../assets/OS/freebsd.svg';
import { ReactComponent as KylinSvg } from '../assets/OS/kylin.svg';
import { ReactComponent as NeokylinSvg } from '../assets/OS/neokylin.svg';
import { ReactComponent as OpeneulerSvg } from '../assets/OS/openeuler.svg';
import { ReactComponent as RedhatSvg } from '../assets/OS/redhat.svg';
import { ReactComponent as SuseSvg } from '../assets/OS/suse.svg';
import { ReactComponent as UbuntuSvg } from '../assets/OS/ubuntu.svg';
import { ReactComponent as UosSvg } from '../assets/OS/uos.svg';
import { ReactComponent as WindowsSvg } from '../assets/OS/windows.svg';
import { ReactComponent as DefaultOsSvg } from '../assets/OS/default-os.svg';

interface OsIconProps {
  /** OS name or image name to resolve icon from */
  osName: string;
  className?: string;
  style?: React.CSSProperties;
}

const OS_MATCHERS = [
  // Windows
  { keywords: ['windows', 'win10', 'win11', 'win2019', 'win2022', 'ws2019', 'ws2022'], component: WindowsSvg },
  
  // Linux - International
  { keywords: ['ubuntu'], component: UbuntuSvg },
  { keywords: ['centos', 'rocky', 'alma', 'amazon'], component: CentosSvg },
  { keywords: ['debian'], component: DebianSvg },
  { keywords: ['redhat', 'red hat', 'rhel', 'oracle', 'ol8', 'ol9'], component: RedhatSvg },
  { keywords: ['fedora', 'coreos'], component: FedoraSvg },
  { keywords: ['suse', 'opensuse', 'sles'], component: SuseSvg },
  { keywords: ['android'], component: AndroidSvg },
  { keywords: ['freebsd', 'bsd'], component: FreebsdSvg },
  
  // Linux - Chinese (信创)
  { keywords: ['kylin', 'kylinos', 'galaxy'], component: KylinSvg },
  { keywords: ['neokylin'], component: NeokylinSvg },
  { keywords: ['uos', 'uniontech', 'deepin'], component: UosSvg },
  { keywords: ['openeuler', 'euler'], component: OpeneulerSvg },
  { keywords: ['anolis', 'openanolis'], component: AnolisSvg },
];

export const getOsKeywordGroups = () => OS_MATCHERS.map(m => m.keywords);

/**
 * 统一的操作系统图标组件
 * 根据传入的 osName 自动匹配显示对应的图标
 */
export const OsIcon: React.FC<OsIconProps> = ({ osName, className, style }) => {
  const n = (osName || '').toLowerCase();
  
  // 1. Try to find a match in the SVG list
  for (const matcher of OS_MATCHERS) {
    if (matcher.keywords.some(k => n.includes(k))) {
      return <Icon component={matcher.component} className={className} style={{ fontSize: 16, ...style }} />;
    }
  }

  // 2. Generic Linux fallback if 'linux' is in the name but no specific distro matched
  if (n.includes('linux')) {
    return <span className={className} style={{ fontSize: 16, marginRight: 4, display: 'inline-block', lineHeight: 1, ...style }}>🐧</span>;
  }

  // 3. Default fallback
  return <Icon component={DefaultOsSvg} className={className} style={{ color: '#000', fill: '#000', fontSize: 16, ...style }} />;
};
