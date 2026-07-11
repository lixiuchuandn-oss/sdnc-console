package cn.com.rivercloud.util.result;

import com.alibaba.fastjson.JSONObject;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;

import java.io.Serializable;
import java.util.HashMap;
import java.util.Map;

/**
 * description: Result <br>
 * date: 2021/7/9 18:50 <br>
 * version: 1.0 <br>
 *
 * @author 温高峰
 */
@Data
@Slf4j
public class ApiResult implements Serializable {
    private static final long serialVersionUID = -5372450875750675775L;


    /**
     * 编码
     */
    private Integer status_code;

    /**
     * 数据
     */
    private Object data;


    public ApiResult() {
    }


    public static ApiResult success() {
        ApiResult result = new ApiResult();
        Map<String, String> msgMap = new HashMap<>(16);
        msgMap.put("msg", "success");
        result.setResultCode(ApiResultCode.SUCCESS);
        result.setData(msgMap);
        return result;
    }

    public static ApiResult successId(String name, String value) {
        ApiResult result = new ApiResult();
        Map<String, String> msgMap = new HashMap<>(16);
        msgMap.put("msg", "success");
        msgMap.put(name, value);
        result.setResultCode(ApiResultCode.SUCCESS);
        result.setData(msgMap);
        return result;
    }

    public static ApiResult success(Object data) {
        ApiResult result = new ApiResult();
        result.setResultCode(ApiResultCode.SUCCESS);
        result.setData(data);
        return result;
    }

    public static ApiResult failure(ApiResultCode apiResultCode) {
        ApiResult result = new ApiResult();
        result.setResultCode(apiResultCode);
        return result;
    }

    public static ApiResult failure() {
        ApiResult result = new ApiResult();
        Map<String, String> msgMap = new HashMap<>(16);
        msgMap.put("msg", ApiResultCode.INTERNAL_SERVER_ERROR.message());
        result.setResultCode(ApiResultCode.INTERNAL_SERVER_ERROR);
        result.setData(msgMap);
        return result;
    }


    public static ApiResult failure(ApiResultCode apiResultCode, Object data) {
        ApiResult result = new ApiResult();
        result.setResultCode(apiResultCode);
        result.setData(data);
        return result;
    }

    public static ApiResult failureDataMsg(ApiResultCode apiResultCode, String dataMsg) {
        Map<String, String> msgMap = new HashMap<>(16);
        msgMap.put("msg", dataMsg);
        ApiResult result = new ApiResult();
        result.setResultCode(apiResultCode);
        result.setData(msgMap);
        return result;
    }

    public void setResultCode(ApiResultCode code) {
        this.status_code = code.code();
    }

    public static long getSerialversionuid() {
        return serialVersionUID;
    }

    public JSONObject build() {
        JSONObject result = new JSONObject();
        result.put("status_code", status_code);
        result.put("data", data);
        log.info("返回结果为：" + result);
        return result;
    }
}
