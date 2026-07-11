package cn.com.rivercloud.util.common;

import cn.com.rivercloud.util.result.ApiResult;
import com.alibaba.fastjson.JSONObject;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.lang.StringUtils;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/**
 * 加密验证工具类 wgf
 * @author 温高峰
 */
@Slf4j
public class SignAtureUtil {
    /**
     * 将加密后的字节数组转换成字符串
     *
     * @param b 字节数组
     * @return 字符串
     */
    public  static String byteArrayToHexString(byte[] b) {
        StringBuilder hs = new StringBuilder();
        String stmp;
        for (int n = 0; b!=null && n < b.length; n++) {
            stmp = Integer.toHexString(b[n] & 0XFF);
            if (stmp.length() == 1) {
                hs.append('0');
            }
            hs.append(stmp);
        }
        return hs.toString().toLowerCase();
    }
    /**
     * sha256_HMAC加密
     * @param message 消息
     * @param secret  秘钥
     * @return 加密后字符串
     */
    public static String sha256_HMAC(String message, String secret) {
        String hash = "";
        try {
            Mac sha256_HMAC = Mac.getInstance("HmacSHA256");
            SecretKeySpec secret_key = new SecretKeySpec(secret.getBytes(), "HmacSHA256");
            sha256_HMAC.init(secret_key);
            byte[] bytes = sha256_HMAC.doFinal(message.getBytes());
            hash = byteArrayToHexString(bytes);
        } catch (Exception e) {
            System.out.println("Error HmacSHA256 ===========" + e.getMessage());
        }
        return hash;
    }

    public static JSONObject getSign(String url, String method, String other, String body,String accessKey,String secretKey){
        Map<String,Object> map= new HashMap(16);

        //定义method 和 requestUrl
        //String method = "GET";
        //String url = "/api/v2.0/resourcepool/template/ne/list";
        long tonce = System.currentTimeMillis() * 1000;
        //输出当前时间戳16位数
        StringBuilder signStr = new StringBuilder();
        signStr.append(method).append("|")
                .append(url).append("|")
                .append(tonce).append("|")
                .append(accessKey);

        //请求参数-other
        if(StringUtils.isNotBlank(other)){
            signStr.append("|")
                    .append(other);
        }else {
            signStr.append("|");
        }

        if(StringUtils.isNotBlank(body)){
            //请求参数-body md5加密
            signStr.append("|")
                    .append(DigestUtils.md5Hex(body));
        }else {
            signStr.append("|");
        }
        //signStr.append(SECRETKEY);
        log.info("sign测试接口——最终拼接的str："+signStr);
        String sha256Str = sha256_HMAC(signStr.toString(),secretKey);

        log.info("sign测试接口——sha256Str加密后的str：："+sha256Str);

        //拼接字符串
        String baseStr = accessKey+":"+sha256Str;
        log.info("sign测试接口——编码前的请求头Authorization信息："+baseStr);
        //BASE64
        String sign = Base64.getEncoder().encodeToString(baseStr.getBytes(StandardCharsets.UTF_8));
        log.info("sign测试接口——编码后的请求头Authorization信息："+sign);
        map.put("tonce",tonce);
        map.put("Authorization",sign);

        return ApiResult.success(map).build();
    }









    public static void main(String [] args){

        Map<String,Object> map= new HashMap(16);

        String accressKey = "admin";
        String secretKey = "admin";

        //定义method 和 requestUrl
        String method = "GET";
        String url = "/V1.0/ctcontrol/VM01/pool";
        long tonce = System.currentTimeMillis() * 1000;
        //输出当前时间戳16位数
        System.out.println("tonce："+System.currentTimeMillis() * 1000);

        StringBuilder signStr = new StringBuilder();
        signStr.append(method).append("|")
                .append(url).append("|")
                .append("1635470251546000").append("|")
                .append(accressKey);

        //请求参数-other
        if(false){
            signStr.append("|")
                    .append("resourcePoolId=60c9e1be1cb0e2106376ac25");
        }else {
            signStr.append("|");
        }

        if(false){
            //请求参数-body md5加密
            signStr.append("|")
                    .append(DigestUtils.md5Hex(""));
        }else {
            signStr.append("|");
        }
        //signStr.append(secretkey);
        System.out.println("signStr========:"+signStr);

        String sha256Str = sha256_HMAC(signStr.toString(),secretKey);
        System.out.println("sign========:"+sha256Str);
        //拼接字符串
        String baseStr = accressKey+":"+sha256Str;
        //BASE64
        String s = Base64.getEncoder().encodeToString(baseStr.getBytes());
        System.out.println("base64========:"+s);

        map.put("tonce",tonce);
        map.put("sign",s);
        System.out.println("sign:======"+map.get("sign"));
    }
}
