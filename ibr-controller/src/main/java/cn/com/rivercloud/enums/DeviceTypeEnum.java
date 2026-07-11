package cn.com.rivercloud.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * @author LiYutao
 * @date 2024/11/14
 * @description
 */
@Getter
@AllArgsConstructor
public enum DeviceTypeEnum {

    VR("vr", "vr虚拟机");

    private final String type;

    private final String desc;
}
