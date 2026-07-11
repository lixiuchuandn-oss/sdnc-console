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
public enum DeviceHealthEnum {

    ONLINE("健康"),

    OFFLINE( "不健康");

    private final String desc;
}

