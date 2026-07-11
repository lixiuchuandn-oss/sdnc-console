package cn.com.rivercloud.service;

import cn.com.rivercloud.bean.vo.PingTestVo;
import cn.com.rivercloud.util.result.ApiPageModeResult;
import cn.com.rivercloud.util.result.Pagination;
import com.alibaba.fastjson.JSONObject;

/**
 * @author LiYutao
 * @date 2024/11/12
 * @description
 */
public interface VrService {

    /**
     * 分页获取VR虚机
     * @param result
     * @param pagination
     * @return
     */
    JSONObject pageList(ApiPageModeResult result, Pagination pagination);

    /**
     * 查看VR配置信息
     * @param result
     * @param uuid
     * @return
     */
    JSONObject get(ApiPageModeResult result, String uuid);

    /**
     * ping测试
     * @param result
     * @param pingTestVo
     * @return
     */
    JSONObject pingTest(ApiPageModeResult result, PingTestVo pingTestVo);

    /**
     * 新增或更新VR配置信息
     * @param result
     * @param json
     * @return
     */
    JSONObject addVRConfig(ApiPageModeResult result, String json);

    /**
     * 删除VR配置信息
     * @param result
     * @param uuid
     * @return
     */
    JSONObject deleteVRConfig(ApiPageModeResult result, String uuid);
}
