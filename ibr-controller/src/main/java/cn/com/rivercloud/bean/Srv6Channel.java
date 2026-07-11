package cn.com.rivercloud.bean;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

import java.util.List;

/**
 * @author LiYutao
 * @date 2024/11/18
 * @description
 */
@Data
public class Srv6Channel {

    /**
     * PE设备的bsid
     */
    @JsonProperty("bsid")
    private String bsId;

    /**
     * segment集合
     */
    private List<String> seglist;

    /**
     * CE设备上的路由集合
     */
    private List<String> route;
}
