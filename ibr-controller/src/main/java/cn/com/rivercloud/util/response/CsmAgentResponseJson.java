package cn.com.rivercloud.util.response;


import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.apache.commons.lang.StringUtils;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Data
@NoArgsConstructor
public class CsmAgentResponseJson {
    private int errCode;
    private boolean success;
    private String message;
    private String data;
    private JSONObject dateJson;
    private JSONArray dateArray;

    public CsmAgentResponseJson(JSONObject jsonObject) {
        this.errCode = jsonObject.containsKey("errCode") ? jsonObject.getIntValue("errCode") : 0;
        this.success = jsonObject.containsKey("success") ? jsonObject.getBoolean("success") : false;
        String messageUnicode = jsonObject.containsKey("message") ? jsonObject.getString("message") : "";
        this.message = this.unicodeToString(messageUnicode);
        this.data = jsonObject.containsKey("data") ? jsonObject.getString("data") : "";
        if (isJsonArray(this.data)) {
            this.dateArray = jsonObject.containsKey("data") ? jsonObject.getJSONArray("data") : null;
        }else if (this.data.indexOf("{") == 0){
            this.dateJson = jsonObject.containsKey("data") ? jsonObject.getJSONObject("data") : null;
        }
    }

    private String unicodeToString(String str) {
        if (StringUtils.isBlank(str) || str.indexOf("\\u") < 0) {
            return str;
        }
        Pattern pattern = Pattern.compile("(\\\\u(\\p{XDigit}{4}))");
        Matcher matcher = pattern.matcher(str);
        char ch;
        while (matcher.find()) {
            ch = (char) Integer.parseInt(matcher.group(2), 16);
            str = str.replace(matcher.group(1), ch + "");
        }
        return str;
    }

    public boolean isSuccess() {
        return this.success;
    }

    public String getMessage() {
        return this.message;
    }

    public static boolean isJsonArray(String data) {
        return data != null && data.matches("\\[.*\\]");
    }

    public static void main(String[] args) {
        String jsonData = "[1, 2, 3]";
        String notJsonData = "[1, 2, 3";  // 不完整的 JSON
        String nonArrayData = "Hello [World]";

        System.out.println("Might be JSON Array: " + isJsonArray(jsonData));       // true
        System.out.println("Might be JSON Array: " + isJsonArray(notJsonData));    // false
        System.out.println("Might be JSON Array: " + isJsonArray(nonArrayData));   // false
    }
}
