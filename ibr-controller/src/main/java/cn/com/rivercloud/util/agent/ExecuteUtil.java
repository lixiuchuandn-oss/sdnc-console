package cn.com.rivercloud.util.agent;

import cn.com.rivercloud.util.common.PubMethod;
import cn.com.rivercloud.util.exception.ServiceException;
import cn.com.rivercloud.util.http.HttpsImpl;
import cn.com.rivercloud.util.response.CsmAgentResponseJson;
import com.alibaba.fastjson.JSONObject;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.CollectionUtils;
import org.springframework.util.ObjectUtils;

import javax.annotation.PostConstruct;
import javax.annotation.Resource;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@Slf4j
@Component
public class ExecuteUtil {


    @Resource
    private HttpsImpl https;
    private static ExecuteUtil executeUtil;

    @PostConstruct
    private void init() {
        executeUtil = this;
    }

    public static CsmAgentResponseJson execute(List<String> cmds, String ip, String csmAgentPort) {
        return execute(cmds, ip, Integer.parseInt(csmAgentPort));
    }

//    @ExecTimeOut(label = ExecTimeOut.Label.HTTP,second = 5)
    public static CsmAgentResponseJson execute(List<String> cmds, String ip, Integer csmAgentPort) {
        try {
            log.info("exec ip : {},port :{}, 执行的命令为：{}", ip, csmAgentPort, cmds);
            long startTime = System.currentTimeMillis();
            String string = executeUtil.https.noTokenPost("http", ip, csmAgentPort, CsmAgentRequestTypeEnum.AGENT_EXEC_CMDS_POST.getPath(), JSONObject.toJSON(cmds).toString());
            log.info("csmAgent执行时常:{}ms, 执行结果为：{}", System.currentTimeMillis() - startTime, string);
            CsmAgentResponseJson responseJson = new CsmAgentResponseJson(JSONObject.parseObject(string));
            if (PubMethod.isEmpty(responseJson)) {
                throw new ServiceException(ip + "上的csmAgent异常");
            }
            return responseJson;
        } catch (Exception e) {
            log.error("{}上的csm-agent执行异常{}:", ip, cmds, e);
            throw new ServiceException("csm-agent无法连通，请联系管理员处理！");
        }
    }

//    public static CsmAgentResponseJson executeWriteFile(List<String> fileContents, String fileFullName, String ip, Integer csmAgentPort) {
//        try {
//            log.info("exec ip : {},port :{}, 写入的文件为：{}, 文件内容为: {} ", ip, csmAgentPort, fileFullName, fileContents.toString());
//            long startTime = System.currentTimeMillis();
//            WriteFileEntity writeFileEntity = new WriteFileEntity(fileFullName, fileContents);
//            String string = executeUtil.https.noTokenPost("http", ip, csmAgentPort, CsmAgentRequestTypeEnum.AGENT_EXEC_WRITE_FILE_POST.getPath(), JSONObject.toJSON(writeFileEntity).toString());
//            log.info("csmAgent执行时常:{}ms, 执行结果为：{}", System.currentTimeMillis() - startTime, string);
//            CsmAgentResponseJson responseJson = new CsmAgentResponseJson(JSONObject.parseObject(string));
//            if (PubMethod.isEmpty(responseJson)) {
//                throw new ServiceException(ip + "上的csmAgent异常");
//            }
//            return responseJson;
//        } catch (Exception e) {
//            log.error("{}上的csm-agent执行异常:", ip, e);
//            throw new ServiceException("csm-agent无法连通，请联系管理员处理！");
//        }
//    }


//    public static CsmAgentResponseJson executeWriteFile(List<String> fileContents, String fileFullName,  String ip, String csmAgentPort) {
//        return executeWriteFile(fileContents, fileFullName, ip, Integer.parseInt(csmAgentPort));
//    }

    public static CsmAgentResponseJson executeReadFile(List<String> fileFullPaths, String ip, Integer csmAgentPort) {
        try {
            log.info("exec ip : {},port :{}, 读取的文件为：{} ", ip, csmAgentPort, fileFullPaths);
            long startTime = System.currentTimeMillis();
            String string = executeUtil.https.noTokenPost("http", ip, csmAgentPort, CsmAgentRequestTypeEnum.AGENT_EXEC_READ_FILE_POST.getPath(), JSONObject.toJSON(fileFullPaths).toString());
            log.info("csmAgent执行时常:{}ms, 执行结果为：{}", System.currentTimeMillis() - startTime, string);
            CsmAgentResponseJson responseJson = new CsmAgentResponseJson(JSONObject.parseObject(string));
            if (ObjectUtils.isEmpty(responseJson) || CollectionUtils.isEmpty(responseJson.getDateArray())) {
                throw new ServiceException(ip + "上的csmAgent异常");
            }
            return responseJson;
        } catch (Exception e) {
            log.error("{}上的csm-agent执行异常:", ip, e);
            throw new ServiceException("csm-agent无法连通，请联系管理员处理！");
        }
    }

//    @ExecTimeOut(label = ExecTimeOut.Label.HTTP,second = 5)
    public static CsmAgentResponseJson executeReadFile(List<String> fileFullPaths,  String ip, String csmAgentPort) {
        return executeReadFile(fileFullPaths, ip, Integer.parseInt(csmAgentPort));
    }

    /**
     * csmagent 长链接命令
     */
    public static CsmAgentResponseJson execLongCmdAgent(List<String> cmds, String ip, Integer csmAgentPort, String headerKey, String headerValue) {
        try {
            log.info("exec ip : {},port :{}, 执行的命令为：{}", ip, csmAgentPort, cmds);
            long startTime = System.currentTimeMillis();
            String body = JSONObject.toJSON(cmds).toString();
            String string = executeUtil.https.noTokenCmdPost("http", ip, csmAgentPort,
                    CsmAgentRequestTypeEnum.AGENT_EXEC_LONG_CMDS_POST.getPath(), body,
                    headerKey, headerValue);
            log.info("csmAgent执行时常:{}ms, 执行结果为：{}", System.currentTimeMillis() - startTime, string);
            CsmAgentResponseJson responseJson = new CsmAgentResponseJson(JSONObject.parseObject(string));
            if (PubMethod.isEmpty(responseJson)) {
                throw new ServiceException(ip + "上的csmAgent异常");
            }
            return responseJson;
        } catch (Exception e) {
            log.error("{}上的csm-agent执行异常{}:", ip, cmds, e);
            throw new ServiceException("csm-agent无法连通，请联系管理员处理！");
        }
    }

    public static CsmAgentResponseJson execLongCmdAgent(List<String> cmds,  String ip, String csmAgentPort, String headerKey, String headerValue) {
        return execLongCmdAgent(cmds, ip, Integer.parseInt(csmAgentPort), headerKey, headerValue);
    }


    /**
     * csmagent 长链接轮训命令
     */
    public static CsmAgentResponseJson execLongCmdAgentSelect(String ip, Integer csmAgentPort, String key) {
        try {
            log.info("exec ip : {},port :{}, 进行长轮训操作!", ip, csmAgentPort);
            long startTime = System.currentTimeMillis();
            String string = executeUtil.https.noTokenGet("http", ip, csmAgentPort,
                    CsmAgentRequestTypeEnum.AGENT_SELECT_LONG_CMDS_GET.getPath() + "/" + key, "");
            log.info("csmAgent执行时常:{}ms, 执行结果为：{}", System.currentTimeMillis() - startTime, string);
            CsmAgentResponseJson responseJson = new CsmAgentResponseJson(JSONObject.parseObject(string));
            if (PubMethod.isEmpty(responseJson)) {
                throw new ServiceException(ip + "上的csmAgent异常");
            }
            return responseJson;
        } catch (Exception e) {
            log.error("{}上的csm-agent执行异常{}:", ip, e);
            throw new ServiceException("csm-agent无法连通，请联系管理员处理！");
        }
    }

    /**
     * csmagent 长链接轮训命令
     */
    public static CsmAgentResponseJson execLongCmdAgentSelect(String ip, String csmAgentPort, String key) {
        return execLongCmdAgentSelect(ip, Integer.parseInt(csmAgentPort), key);
    }


    public static String executeLocal(List<String> cmds){
        cmds = toDoCmds(cmds);
        String commond = commond(cmds);
        log.info("本地执行shell结果:",commond);
        return commond;
    }
    public static List<String> toDoCmds(List<String> childCmds){
        List<String> cmds = new ArrayList<>();
        cmds.add("/bin/sh");
        cmds.add("-c");
        cmds.add(childCmds.stream().collect(Collectors.joining(" && ")));
        return cmds;
    }
    public static String commond(List<String> cmds){
        String[] strs = new String[cmds.size()];
        String result = null;
        try {
            log.info("exe: {}",cmds);
            result = NatCommandUtil.run(cmds.toArray(strs));
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
        return result;
    }

    public static List<String> executeFormatResult(List<String> cmdList, String ip, Integer port) {
        if (PubMethod.isEmpty(cmdList)) {
            return new ArrayList<>();
        }
        log.info("调用命令：ip:{}, port:{}", ip, port);
        for (String cmd : cmdList) {
            log.info(cmd);
        }
        try {
            String result = executeUtil.https.noTokenPost("http", ip, port, CsmAgentRequestTypeEnum.AGENT_EXEC_CMDS_POST.getPath(), JSONObject.toJSON(cmdList).toString());
            log.info("csmAgent执行结果: {}", result);
            JSONObject json = JSONObject.parseObject(result);
            List<String> resultList = json.getJSONArray("data").toJavaList(String.class);
            resultList = resultList.stream().map(x -> {
                log.info("命令执行结果：{}",x);
                if (x.endsWith("\n")) {
                    return x.substring(0, x.length() - 1);
                }
                return x;
            }).collect(Collectors.toList());
            return resultList;
        } catch (Exception e) {
            log.error("命令下发异常" + e);
            throw new ServiceException("csm-agent无法连通，请联系管理员处理！");
        }
    }

    /**
     * 下发命令（无返回值为正确）
     * @param cmdList
     * @param host
     */
//    public static void executeNoResult(List<String> cmdList, ResPoolManageHost host) {
//        //端口号识别
//        final String[] otherSplit = host.getPort().split(",");
//        int otherHostPort = 8015;
//        if (otherSplit.length > 0) {
//            otherHostPort = Integer.parseInt(otherSplit[0]);
//        }
//        List<String> resultList = executeFormatResult(cmdList, host.getManageIp(), otherHostPort);
//        if (!PubMethod.isEmpty(resultList)) {
//            for (String result : resultList) {
//                if (!PubMethod.isEmpty(result)) {
//                    throw new ServiceException("命令下发失败！");
//                }
//            }
//        }
//    }
}
