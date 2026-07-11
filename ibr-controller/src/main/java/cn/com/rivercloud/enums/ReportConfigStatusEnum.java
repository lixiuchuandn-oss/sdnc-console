package cn.com.rivercloud.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum ReportConfigStatusEnum {

    applied("applied", "配置生效"),

    error("error", "配置未生效");

    private final String val;

    private final String desc;
}
