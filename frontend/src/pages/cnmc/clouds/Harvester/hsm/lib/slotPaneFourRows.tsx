/**
 * 机架单槽网口/交换口：凹槽 `.cloudmap-dc-tp-groove` 内 1~4 行（有则渲染，见 hsm.css `.cloudmap-dc-tp-row*`）
 */
import React from 'react';

export type SlotPaneFourRowsProps = {
  line1: string;
  line2: string;
  line3?: string | null;
  line4?: string | null;
  led1Class: string;
  led2Class: string;
  /** 如 LldpCornerBadge，叠在 groove 内左上 */
  topLeftBadge?: React.ReactNode;
  paneClassName?: string;
  line2UsesNicTone?: boolean;
};

export function SlotPaneFourRows({
  line1,
  line2,
  line3,
  line4,
  led1Class,
  led2Class,
  topLeftBadge,
  paneClassName = '',
  line2UsesNicTone = true,
}: SlotPaneFourRowsProps) {
  return (
    <>
      <div className="cloudmap-dc-tp-slot-handle" aria-hidden />
      <div className={['cloudmap-dc-tp-groove', paneClassName].filter(Boolean).join(' ')}>
        {topLeftBadge}
        <span className="cloudmap-dc-tp-row cloudmap-dc-tp-row--1" title={line1}>
          {line1}
        </span>
        <span
          className={[
            'cloudmap-dc-tp-row',
            'cloudmap-dc-tp-row--2',
            line2UsesNicTone ? 'cloudmap-dc-tp-row--2-nic' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          title={line2}
        >
          {line2}
        </span>
        {line3 ? (
          <span className="cloudmap-dc-tp-row cloudmap-dc-tp-row--3" title={line3}>
            {line3}
          </span>
        ) : null}
        {line4 ? (
          <span className="cloudmap-dc-tp-row cloudmap-dc-tp-row--4" title={line4}>
            {line4}
          </span>
        ) : null}
      </div>
      <div className="cloudmap-dc-tp-slot-leds" aria-hidden>
        <span className={`cloudmap-dc-tp-slot-led ${led1Class}`} />
        <span className={`cloudmap-dc-tp-slot-led ${led2Class}`} />
      </div>
    </>
  );
}
