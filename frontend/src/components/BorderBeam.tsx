import React from "react";
import "./BorderBeam.css";

export type BorderBeamProps = {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** 流光高亮色 */
  colorFrom?: string;
  /** 流光渐变色 */
  colorTo?: string;
  /** 旋转一圈耗时（秒） */
  duration?: number;
  borderWidth?: number;
  borderRadius?: number;
  /** 内容区背景 */
  innerBackground?: string;
};

/** 边框流光容器：外层旋转锥形渐变 + 内层实底内容区 */
const BorderBeam: React.FC<BorderBeamProps> = ({
  children,
  className = "",
  style,
  colorFrom = "#1890ff",
  colorTo = "#69c0ff",
  duration = 4,
  borderWidth = 1,
  borderRadius = 8,
  innerBackground = "#ffffff",
}) => (
  <div
    className={`border-beam ${className}`.trim()}
    style={{
      ...style,
      ["--bb-from" as string]: colorFrom,
      ["--bb-to" as string]: colorTo,
      ["--bb-duration" as string]: `${duration}s`,
      ["--bb-width" as string]: `${borderWidth}px`,
      ["--bb-radius" as string]: `${borderRadius}px`,
      ["--bb-inner-bg" as string]: innerBackground,
    }}
  >
    <span className="border-beam__track" aria-hidden />
    <div className="border-beam__inner">{children}</div>
  </div>
);

export default BorderBeam;
