package cn.com.rivercloud.util.agent;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Scanner;
import java.util.concurrent.TimeUnit;

public class NatCommandUtil {

    public static Logger logger = LoggerFactory.getLogger(NatCommandUtil.class);

    public static String run(String command) throws IOException {
        Scanner input = null;
        String result = "";
        Process process = null;
        try {
            process = Runtime.getRuntime().exec(command);
            try {
                //等待命令执行完成
                process.waitFor(10, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
            InputStream is = process.getInputStream();
            input = new Scanner(is);
            while (input.hasNextLine()) {
                result += input.nextLine() + "\n";
            }
//            result = result; //加上命令本身，打印出来
        } catch (Exception e){
            logger.error("执行NAT命令失败："+command+", 返回结果："+result+", 错误信息："+e.getMessage());
        }finally {
            if (input != null) {
                input.close();
            }
            if (process != null) {
                process.destroy();
            }
        }
        logger.info("命令："+command+", 返回结果："+result);
        return result;
    }

    public static String run(String[] command) throws IOException {
        Scanner input = null;
        String result = "";
        Process process = null;
        try {
            process = Runtime.getRuntime().exec(command);
            try {
                //等待命令执行完成
                process.waitFor(10, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
            InputStream is = process.getInputStream();
            input = new Scanner(is);
            while (input.hasNextLine()) {
                result += input.nextLine() + "\n";
            }
//            result = command + "\n" + result; //加上命令本身，打印出来
        } catch (Exception e){
            logger.error("执行NAT命令失败："+ Arrays.toString(command)+", 返回结果："+result+", 错误信息："+e.getMessage());
        } finally {
            if (input != null) {
                input.close();
            }
            if (process != null) {
                process.destroy();
            }
        }
        logger.info("配置NAT信息,命令："+Arrays.toString(command)+", 返回结果："+result);
        return result;
    }
}
