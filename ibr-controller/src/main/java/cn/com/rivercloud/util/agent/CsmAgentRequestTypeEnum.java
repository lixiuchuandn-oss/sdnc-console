package cn.com.rivercloud.util.agent;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum CsmAgentRequestTypeEnum {

    /******************************************************** Libvrit虚拟机管理(begin) ***************************************************************/
    LIBVRIT_TESTCONN_GET("LIBVRIT_TESTCONN_GET", "GET", "/v1.0/libvirt/agent/testConn", "Agent的连通性测试"),
    LIBVRIT_DELCSMIP_POST("LIBVRIT_DELCSMIP_POST", "POST", "/v1.0/libvirt/agent/delCsmIp", "将平台IP从Agent白名单中剔除"),
    LIBVRIT_ADDCSMIP_POST("LIBVRIT_ADD_CSMIP_POST", "POST", "/v1.0/libvirt/agent/addCsmIp", "将平台IP添加到Agent白名单中"),
    LIBVRIT_NAME_GET("LIBVRIT_NAME_GET", "GET", "/v1.0/libvirt/agent/domain/name/", "根据name查询是否存在"),
    LIBVRIT_UUID_GET("LIBVRIT_UUID_GET", "GET", "/v1.0/libvirt/agent/domain/uuid/", "根据uuid查询是否存在"),
    LIBVRIT_STATUS_GET("LIBVRIT_STATUS_GET", "GET", "/v1.0/libvirt/agent/domain/status/", "根据name查询状态"),
    LIBVRIT_START_GET("LIBVRIT_START_GET", "GET", "/v1.0/libvirt/agent/domain/create/", "根据name启动虚机"),
    LIBVRIT_RESTART_GET("LIBVRIT_RESTART_GET", "GET", "/v1.0/libvirt/agent/domain/reboot/", "根据name重启虚机"),
    LIBVRIT_STOP_GET("LIBVRIT_STOP_GET", "GET", "/v1.0/libvirt/agent/domain/destroy/", "根据name关闭虚机"),
    LIBVRIT_SHUTDOWN_GET("LIBVRIT_SHUTDOWN_GET", "GET", "/v1.0/libvirt/agent/domain/shutdown/", "根据name软关闭虚机"),
    LIBVRIT_UNDEFINE_GET("LIBVRIT_UNDEFINE_GET", "GET", "/v1.0/libvirt/agent/domain/undefine/", "根据name undefine虚机"),
    LIBVRIT_DEFINE_POST("LIBVRIT_DEFINE_POST", "POST", "/v1.0/libvirt/agent/domain/define", "define虚机"),
    LIBVRIT_HOST_CPUNUM_GET("LIBVRIT_HOST_CPUNUM_GET", "GET", "/v1.0/libvirt/agent/host/cpu_num", "获取主机cpu数"),
    LIBVRIT_DEV_MONITOR_GET("LIBVRIT_DEV_MONITOR_GET", "GET", "/v1.0/libvirt/agent/domain/monitor/", "获取主机cpu数"),
    LIBVRIT_BATCH_STATUS_POST("LIBVRIT_STATUS_GET", "POST", "/v1.0/libvirt/agent/domain/batchStatus/", "根据name批量查询虚机状态"),
    LIBVRIT_UPDATE_OS_BOOT_POST("LIBVRIT_UPDATE_OS_BOOT_POST", "POST", "/v1.0/libvirt/agent//domain/updateOsBoot/", "根据uuid更新虚机的启动状态"),
    LIBVRIT_DELETE_ISO_DISK_POST("LIBVRIT_DELETE_ISO_DISK_POST", "POST", "/v1.0/libvirt/agent//domain/deleteIsoDisk/", "根据uuid给虚机摘除iso镜像"),
    LIBVRIT_ADD_ISO_DISK_POST("LIBVRIT_ADD_ISO_DISK_POST", "POST", "/v1.0/libvirt/agent//domain/addIsoDisk/", "根据uuid给虚机挂载iso镜像"),
    /******************************************************** Libvrit虚拟机管理(end) ***************************************************************/

    /******************************************************** Docker管理(begin) ***************************************************************/

    /******************************************************** Docker管理(end) ***************************************************************/

    /******************************************************** 命令行(begin) ***************************************************************/
    AGENT_EXEC_CMDS_POST("AGENT_EXEC_CMDS_POST", "POST", "/v1.0/agent/cmds", "通过代理执行命令"),
    AGENT_EXEC_LONG_CMDS_POST("AGENT_EXEC_LONG_CMDS_POST", "POST", "/v1.0/agent/cmds/execLongTime", "通过代理执行长链接命令"),
    AGENT_SELECT_LONG_CMDS_GET("AGENT_SELECT_LONG_CMDS_GET", "GET", "/v1.0/agent/cmds/getExecResult", "通过代理查询长链接命令"),
    AGENT_EXEC_WRITE_FILE_POST("AGENT_EXEC_WRITE_FILE_POST", "POST", "/v1.0/agent/cmds/execWriteFileCmds", "通过代理执行写入文件命令"),
    AGENT_EXEC_READ_FILE_POST("AGENT_EXEC_READ_FILE_POST", "POST", "/v1.0/agent/cmds/execReadFileCmds", "通过代理执行读取文件命令"),
    /******************************************************** 命令行(end) ***************************************************************/

    ;

    /**
     * 方法名称
     */
    private final String name;
    /**
     * 调用方法
     */
    private final String method;
    /**
     * 路径
     */
    private final String path;
    /**
     * 描述
     */
    private final String summary;
}