/**
 * 机架条 / 内嵌面板顶栏共用：电源感双灯（与节点、占位条视觉一致）。
 */
import React from 'react';

export type BladeHealthLed = 'ok' | 'warn' | 'err';

export function BladePowerLeds({ state }: { state: BladeHealthLed }) {
  const ledClass =
    state === 'ok'
      ? 'cloudmap-dc-pchrome-health-led--ok'
      : state === 'err'
        ? 'cloudmap-dc-pchrome-health-led--err'
        : 'cloudmap-dc-pchrome-health-led--warn';
  const title =
    state === 'ok' ? '采集侧未报健康异常' : state === 'err' ? '存在健康异常（详见详情）' : '状态未知或未采集';
  return (
    <div className="cloudmap-dc-pchrome-health-leds-inner cloudmap-dc-pchrome-health-leds" aria-label="状态灯">
      <span className={`cloudmap-dc-pchrome-health-led ${ledClass}`} title={title} />
      <span
        className="cloudmap-dc-pchrome-health-led cloudmap-dc-pchrome-health-led--warn"
        style={{ opacity: 0.35 }}
        aria-hidden
      />
    </div>
  );
}
