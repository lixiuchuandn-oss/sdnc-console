package cn.com.rivercloud.util.ip;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;


/**
 * @author gp
 */
@Component
@Slf4j
public class Ping {
    
    public static boolean isOk(String ip) {
        Runtime runtime = Runtime.getRuntime();
        Process process = null;
        String line = null;
        InputStream is = null;
        InputStreamReader isr = null;
        BufferedReader br = null;
        boolean isOk = false;
        try {
            //
            int time = 2;//间隔时间
            int times = 30;//间隔时间//次数
            if (CSMCKernel.platform == CSMCKernel.OS.windows) {
                process = runtime.exec("ping " + ip + " -w " + time + "  -n " + times);
            }
            if (CSMCKernel.platform == CSMCKernel.OS.linux) {
                process = runtime.exec("ping " + ip + " -w " + time + "  -c " + times);
            }
            is = process.getInputStream();
            isr = new InputStreamReader(is, "GBK");// 把输入流转换成字节流
            br = new BufferedReader(isr);
            int counter = 0;
            while ((line = br.readLine()) != null) {
                if (line.toUpperCase().contains("TTL") || line.contains("ttl")) {
                    isOk = true;
                    break;
                }
                if (counter > times) {
                    log.warn("ping " + ip + "第" + counter + "次ping的结果:" + line.toUpperCase());
                    break;
                }
                counter++;

            }
            return isOk;
        } catch (IOException e) {
            log.error("ping " + ip + "错误!,e = " + e.getMessage());
        } finally {
            try {
                if (null != is) {
                    is.close();
                }
                if (null != isr) {
                    isr.close();
                }
                if (null != br) {
                    br.close();
                }
            } catch (IOException e) {
                log.error("ping " + ip + "错误!,e = " + e.getMessage());
            }
        }
        return false;
    }


    /**
     * ping 检测
     *
     * @param ip    主机IP
     * @param time  单次PING的超时时间（根据业务场景自行调整）
     * @param count PING的总次数 （根据业务场景自行调整）
     */
    public static boolean isOk(String ip, int time, int count) {
        Runtime runtime = Runtime.getRuntime();
        Process process = null;
        String line = null;
        InputStream is = null;
        InputStreamReader isr = null;
        BufferedReader br = null;
        boolean isOk = false;
        try {
            if (CSMCKernel.platform == CSMCKernel.OS.windows) {
                process = runtime.exec("ping " + ip + " -w " + time + "  -n " + count);
            }
            if (CSMCKernel.platform == CSMCKernel.OS.linux) {
                process = runtime.exec("ping " + ip + " -w " + time + "  -c " + count);
            }
            is = process.getInputStream();
            isr = new InputStreamReader(is, "GBK");// 把输入流转换成字节流
            br = new BufferedReader(isr);
            while ((line = br.readLine()) != null) {
                if (line.toUpperCase().contains("TTL") || line.contains("ttl")) {
                    isOk = true;
                    break;
                }
            }
            return isOk;
        } catch (IOException e) {
            log.error("ping " + ip + "错误!,e = " + e.getMessage());
        } finally {
            try {
                if (null != is) {
                    is.close();
                }
                if (null != isr) {
                    isr.close();
                }
                if (null != br) {
                    br.close();
                }
            } catch (IOException e) {
                log.error("ping " + ip + "错误!,e = " + e.getMessage());
            }
        }
        return false;
    }
}
