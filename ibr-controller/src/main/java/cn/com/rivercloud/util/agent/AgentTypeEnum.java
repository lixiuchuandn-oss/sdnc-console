package cn.com.rivercloud.util.agent;

import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.Arrays;

@Getter
@AllArgsConstructor
public enum AgentTypeEnum {

    MONITOR_AGENT(1,"监控agent","监控",21023,"/system/upgrade-agent.aj",1666421947000l,"1.0.11"),
    MONITOR_SERVER(2,"监控AgentServer","Server",21023,"/system/upgrade-server.aj",1679542323000l,"1.0.33"),
    CSM_AGENT(3,"虚拟机管理","CSM",8015,"/v1.0/agent/system/upgrade",1666261092000l,"csm2.0_20221020181812"),
    CATEGRAF(4,"categraf","监控",19000,"",1710145819000L,"0.0.1"),
    N9E(5,"夜莺","Server",17000,"",1710145852000L,"0.0.1");

    private final Integer type;
    private final String name;
    private final String versionName;
    private final Integer port;
    private final String upgradePath;

    //初始化时间
    private final long initTime;
    //初始化版本
    private final String initVersion;

    public static AgentTypeEnum get(Integer type){
        return Arrays.stream(values()).filter(item->item.getType() == type).findFirst().get();
    }
    public static AgentTypeEnum get(String name){
        return Arrays.stream(values()).filter(item->item.getName().equals(name)).findFirst().get();
    }
}
