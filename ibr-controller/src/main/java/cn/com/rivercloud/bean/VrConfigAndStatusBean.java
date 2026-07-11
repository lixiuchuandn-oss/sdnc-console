package cn.com.rivercloud.bean;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import org.jongo.marshall.jackson.oid.MongoId;
import org.jongo.marshall.jackson.oid.MongoObjectId;

import java.util.Date;
import java.util.List;

/**
 * @author LiYutao
 * @date 2024/11/14
 * @description
 */
@Data
public class VrConfigAndStatusBean {

    @MongoId
    @MongoObjectId
    private String id;

    /**
     * 唯一标识
     */
    private String uuid;

    /**
     * srv6信息
     */
    private Srv6 srv6;

    /**
     * 接口信息
     */
    private List<Interface> interfaces;

    /**
     * 资源指标
     */
    private ResourceIndicators resourceIndicators;

    private List<Ipsec> ipsec;

    private String gateway;

    private Date createDate;

    private Date updateDate;

    @Data
    private static class Ipsec {

        private String id;

        private In in;

        private Out out;
    }

    /**
     * 接收的数据
     */
    @Data
    private static class In {

        /**
         * 接收的字节数
         */
        private Long bytes;

        /**
         * 接收的数据包数
         */
        private Long packets;
    }

    @Data
    private static class Out {

        /**
         * 发送的字节数
         */
        private Long bytes;

        /**
         * 发送的数据包数
         */
        private Long packets;
    }

    @Data
    public static class Srv6 {

        /**
         * vr上的srv6的localsid
         */
        @JsonProperty("localsid")
        private String localSid;

        /**
         * 一般是vrfid
         */
        private String vpn;

        /**
         * srv6隧道集合
         */
        private List<Srv6Channel> srv6list;
    }

    @Data
    public static class Interface {

        private String name;

        private int vlan;

        private int vrf;

        @JsonProperty("ipv4_static")
        private String ipv4Static;

        @JsonProperty("ipv6_static")
        private String ipv6Static;

        private String status;

        /**
         * 接收数据包个数（每秒）
         */
        private long receivePacketsPerSecond;

        /**
         * 发送数据包个数（每秒）
         */
        private long transmitPacketsPerSecond;

        /**
         * 接收数据速率（比特/秒）
         */
        private double receiveRateBps;

        /**
         * 发送数据速率（比特/秒）
         */
        private double transmitRateBps;
    }

    @Data
    public static class ResourceIndicators {

        /**
         * cpu总数
         */
        private long cpuTotal;

        /**
         * cpu使用率
         */
        private double cpuUsed;

        /**
         * 总内存大小
         */
        private double memoryTotal;

        /**
         * 内存使用率
         */
        private double memoryUsed;
    }
}
