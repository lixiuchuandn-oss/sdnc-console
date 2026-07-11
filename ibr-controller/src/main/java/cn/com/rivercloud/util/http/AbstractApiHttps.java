package cn.com.rivercloud.util.http;

import com.alibaba.fastjson.JSONObject;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

@Component
public class AbstractApiHttps<T> extends AbstractHttps<T> implements ApiHttps {

    @Override
    public void addHeaders(HttpHeaders headers) {
        MediaType type = MediaType.parseMediaType("application/json; charset=UTF-8");
        headers.setContentType(type);
    }

    @Override
    public HttpHeaders headers() {
        HttpHeaders headers = new HttpHeaders();
        addHeaders(headers);
        return headers;
    }

    public void xmlAddHeaders(HttpHeaders headers) {
        MediaType type = MediaType.parseMediaType("text/xml; charset=ISO-8859-1");
        headers.setContentType(type);
    }

    public HttpHeaders xmlHeaders() {
        HttpHeaders headers = new HttpHeaders();
        xmlAddHeaders(headers);
        return headers;
    }

    public T put(String protocol, String ip, int port, String path, String jsonStr) throws Exception {
        String token = this.getToken(ip, port);
        HttpHeaders headers = headers();
        headers.add("token", token);
        HttpEntity<String> formEntity = new HttpEntity<>(jsonStr, headers);
        return super.put(formEntity, url(protocol, ip, port) + path);
    }

    public T get(String protocol, String ip, int port, String path ) throws Exception {
        HttpHeaders headers = headers();
        HttpEntity<String> formEntity = new HttpEntity<>(headers);
        return super.get(formEntity, url(protocol, ip, port) + path);
    }
    public T get(String protocol, String ip, int port, String path, String jsonStr) throws Exception {
        String token = this.getToken(ip, port);
        HttpHeaders headers = headers();
        headers.add("token", token);
        HttpEntity<String> formEntity = new HttpEntity<>(jsonStr, headers);
        return super.get(formEntity, url(protocol, ip, port) + path);
    }

    public T delete(String protocol, String ip, int port, String path, String jsonStr) throws Exception {
        String token = this.getToken(ip, port);
        HttpHeaders headers = headers();
        headers.add("token", token);
        HttpEntity<String> formEntity = new HttpEntity<>(jsonStr, headers);
        return super.delete(formEntity, url(protocol, ip, port) + path);
    }

    public T post(String protocol, String ip, int port, String path, String jsonStr) throws Exception {
        String token = this.getToken(ip, port);
        HttpHeaders headers = headers();
        headers.add("token", token);
        HttpEntity<String> formEntity = new HttpEntity<>(jsonStr, headers);
        return super.post(formEntity, url(protocol, ip, port) + path);
    }

    public T postToken(String protocol, String ip, int port,String username,String password, String path, String jsonStr) throws Exception {
       // String token = this.getToken(ip, port);
        String token = this.getToken(ip, port,username,password);
        HttpHeaders headers = headers();
        headers.add("token", token);
        HttpEntity<String> formEntity = new HttpEntity<>(jsonStr, headers);
        return super.post(formEntity, url(protocol, ip, port) + path);
    }


    public T delete(String protocol, String ip, int port, String path) throws Exception {
        HttpHeaders headers = headers();
        HttpEntity<String> formEntity = new HttpEntity<>("", headers);
        return super.delete(formEntity, url(protocol, ip, port) + path);
    }

    public T post(String protocol, String ip, int port, String path) throws Exception {
        HttpHeaders headers = headers();
        HttpEntity<String> formEntity = new HttpEntity<>("", headers);
        return super.post(formEntity, url(protocol, ip, port) + path);
    }

    public T noTokenPost(String protocol, String ip, int port, String path, String jsonStr) throws Exception {
        HttpHeaders headers = headers();
        HttpEntity<String> formEntity = new HttpEntity<>(jsonStr, headers);
        return super.post(formEntity, url(protocol, ip, port) + path);
    }

    public T noTokenCmdPost(String protocol, String ip, int port, String path, String jsonStr,String headerKey,String headerValue) throws Exception {
        HttpHeaders headers = headers();
        headers.add("Nonce",headerKey);
        headers.add("Timestamp",headerValue);
        HttpEntity<String> formEntity = new HttpEntity<>(jsonStr, headers);
        return super.post(formEntity, url(protocol, ip, port) + path);
    }

    public T noTokenPostXml(String protocol, String ip, int port, String path, String jsonStr) throws Exception {
        HttpHeaders headers = xmlHeaders();
        HttpEntity<String> formEntity = new HttpEntity<>("", headers);
        return super.post(formEntity, url(protocol, ip, port) + path);
    }

    public T noTokenGet(String protocol, String ip, int port, String path, String jsonStr) throws Exception {
        HttpHeaders headers = headers();
        HttpEntity<String> formEntity = new HttpEntity<>(jsonStr, headers);
        String regUrl = url(protocol, ip, port) + path;
        System.out.println(regUrl);
        return super.get(formEntity, regUrl);
    }


    public T httpsPut(String protocol, String ip, int port, String path, String jsonStr) {
        HttpHeaders headers = headers();
        HttpEntity<String> formEntity = new HttpEntity<>(jsonStr, headers);
        return super.put(formEntity, url(protocol, ip, port) + path);
    }

    public T httpsGet(String protocol, String ip, int port, String path, String jsonStr) {
        HttpHeaders headers = headers();
        HttpEntity<String> formEntity = new HttpEntity<>(jsonStr, headers);
        return super.get(formEntity, url(protocol, ip, port) + path);
    }
    public T httpsPost(String protocol, String ip, int port, String path, String jsonStr) {
        HttpHeaders headers = headers();
        HttpEntity<String> formEntity = new HttpEntity<>(jsonStr, headers);
        return super.post(formEntity, url(protocol, ip, port) + path);
    }

    public T httpsDelete(String protocol, String ip, int port, String path, String jsonStr) throws Exception {
        HttpHeaders headers = headers();
        HttpEntity<String> formEntity = new HttpEntity<>(jsonStr, headers);
        return super.delete(formEntity, url(protocol, ip, port) + path);
    }


    public String getToken(String ip, int port) {
        JSONObject params = new JSONObject();
        params.put("userName", "platformIf");
        params.put("password", "platformIf@123.com");
        String requestJson = JSONObject.toJSONString(params);
        HttpEntity<String> formEntity = new HttpEntity<>(requestJson, headers());
        String urlStr = url("https", ip, port);
        String result = new String();
        try {
            T res = super.post(formEntity, urlStr + "/api/v1/pop/auth");
            result = res instanceof String?(String)res:JSONObject.toJSONString(res);
        } catch (Exception e) {
            e.printStackTrace();
        }

        JSONObject responseJson = JSONObject.parseObject(result);
        if (!responseJson.getBoolean("success")) {
            return "";
        }
        return responseJson.getString("token");
    }
    private String getKey(String key){
        return new StringBuilder(this.getClass().getSimpleName()).append("_").append(key).toString();
    }

    public String getToken(String ip, int port,String username,String password) {
//        String ifPresent = AUTH_KEY_CACHE.getIfPresent(ip);
//        if (!Strings.isEmpty(ifPresent)) {
//            return ifPresent;
//        }
        JSONObject params = new JSONObject();
        params.put("username", username);
        params.put("password", password);
        String requestJson = JSONObject.toJSONString(params);
        HttpEntity<String> formEntity = new HttpEntity<>(requestJson, headers());
        String urlStr = url("https", ip, port);
        String result = new String();
        try {
            T res = super.post(formEntity, urlStr + "/csm/api/v1.0/authentication/auth");
            result = res instanceof String?(String)res:JSONObject.toJSONString(res);
        } catch (Exception e) {
            e.printStackTrace();
        }

        JSONObject responseJson = JSONObject.parseObject(result);
        if (!responseJson.getBoolean("success")) {
            return "";
        }
        String token = responseJson.getString("data");
//        AUTH_KEY_CACHE.put(ip, token);
        return token;
    }

}
