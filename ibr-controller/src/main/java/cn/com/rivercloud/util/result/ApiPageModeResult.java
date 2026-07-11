package cn.com.rivercloud.util.result;

import cn.com.rivercloud.util.common.PubMethod;
import com.alibaba.fastjson.JSONObject;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;

import java.io.Serializable;

/**
 * 刘长河
 */
@Data
@Slf4j
public class ApiPageModeResult implements Serializable {
    private static final long serialVersionUID = -5372450875750675775L;

    private Integer code = 200;

    private String msg = "success";

    private String requestId = "";

    /**
     * 分页data: ApiPageDate
     * 非分页data：Object
     */
    private Object data;

    public ApiPageModeResult() {
    }

    public ApiPageModeResult code(Integer code){
        this.code=code;
        return this;
    }

    public ApiPageModeResult msg(String msg){
        this.msg = msg;
        return this;
    }

    public ApiPageModeResult requestId(String requestId){
        this.requestId = requestId;
        return this;
    }

    public ApiPageModeResult data(Object data) {
        this.data = data;
        return this;
    }

    public JSONObject build() {
        JSONObject result = new JSONObject();
        result.put("code", code);
        if (code != 200 && PubMethod.isEmpty(msg)){
            msg = "error";
        }
        result.put("msg",msg);
        result.put("requestId",requestId);
        result.put("data", data);

        log.info("返回结果为：" + result);
        return result;
    }
}
