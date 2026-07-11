package cn.com.rivercloud.util.common;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * @author songpenghui
 * @create 2020/1/4 2:10 PM
 * @description 参数校验
 */
public class PubMethod {

    /**
     * 对空判断
     * @param value
     * @return
     */
    public static boolean isEmpty(String value) {
        return (value == null || "".equals(value) || "{}".equals(value) || "\r".equals(value));
    }
    public static boolean isEmpty(StringBuffer value) {
        return (value == null || value.length() <= 0);
    }
    public static boolean isEmpty(Double value) {
        return (value == null || value == 0.0);
    }
    public static boolean isEmpty(Long value) {
        return (value == null || value == 0);
    }
    public static boolean isEmpty(List list) {
        return (list == null || list.size() == 0);
    }
    public static boolean isEmpty(Set set) {
        return (set == null || set.size() == 0);
    }
    public static boolean isEmpty(Map map) {
        return (map == null || map.size() == 0);
    }
    public static boolean isEmpty(Object value) {
        return (value == null|| "".equals(value) || new ArrayList<>().equals(value) || new Object().equals(value));
    }
    public static boolean isEmpty(Object[] value) {
        return (value == null || value.length == 0);
    }
}

