package cn.com.rivercloud.bean;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import org.jongo.marshall.jackson.oid.MongoId;
import org.jongo.marshall.jackson.oid.MongoObjectId;

import javax.validation.constraints.NotBlank;
import java.util.Date;

/**
 * @author LiYutao
 * @date 2024/11/14
 * @description
 */
@Data
public class VrDeviceBean {

    @MongoId
    @MongoObjectId
    private String id;

    /**
     * 唯一标识（由底层生成）
     */
    @NotBlank(message = "uuid不能为空")
    private String uuid;

    /**
     * 资源池名称
     */
    @JsonProperty("pool_name")
    private String poolName;

    /**
     * 资源池id
     */
    @JsonProperty("pool_id")
    private String poolId;

    /**
     * 资源池内的虚机ID
     */
    @JsonProperty("vm_id")
    private String vmId;

    /**
     * mac地址
     */
    @NotBlank(message = "mac地址不能为空")
    private String mac;

    /**
     * 名称（不重复），靠名字区分资源池，北向需要配置
     */
    @NotBlank(message = "name不能为空")
    private String name;

    /**
     * vr版本号
     */
    @NotBlank(message = "version不能为空")
    private String version;

    /**
     * 类型
     * @see cn.com.rivercloud.enums.DeviceTypeEnum
     */
    @NotBlank(message = "type不能为空")
    private String type;

    @JsonProperty("health_status")
    private String healthStatus;

    /**
     * 资源指标
     */
    private VrConfigAndStatusBean.ResourceIndicators resourceIndicators;

    private Date createDate;

    private Date updateDate;
}
