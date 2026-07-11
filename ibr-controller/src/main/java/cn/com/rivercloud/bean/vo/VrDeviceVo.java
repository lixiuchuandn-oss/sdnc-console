package cn.com.rivercloud.bean.vo;

import cn.com.rivercloud.bean.VrConfigAndStatusBean;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Builder;
import lombok.Data;
import org.jongo.marshall.jackson.oid.MongoObjectId;

/**
 * @author LiYutao
 * @date 2024/11/14
 * @description
 */
@Data
@Builder
public class VrDeviceVo {


    @MongoObjectId
    private String id;

    /**
     * 唯一标识（南向给的）
     */
    private String uuid;

    /**
     * 资源池id
     */
    @JsonProperty("pool_id")
    private String poolId;

    /**
     * 资源池名称
     */
    @JsonProperty("pool_name")
    private String poolName;

    /**
     * 虚机id
     */
    @JsonProperty("vm_id")
    private String vmId;

    /**
     * mac地址
     */
    private String mac;

    /**
     * 名称（唯一）
     */
    private String name;

    /**
     * 虚机版本号
     */
    private String version;

    /**
     * 类型
     * @see cn.com.rivercloud.enums.DeviceTypeEnum
     */
    private String type;

    @JsonProperty("health_status")
    private String healthStatus;

    private VrConfigAndStatusBean.ResourceIndicators resourceIndicators;
}
