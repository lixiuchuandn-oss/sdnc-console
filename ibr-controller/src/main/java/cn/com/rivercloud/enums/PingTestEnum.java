package cn.com.rivercloud.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * @author LiYutao
 * @date 2024/5/28
 * @description
 */
@Getter
@AllArgsConstructor
public enum PingTestEnum {


    OK("ok", "网络可达"),

    UNREACHABLE("unreachable", "网络不可达");

    private final String val;

    private final String desc;
}
