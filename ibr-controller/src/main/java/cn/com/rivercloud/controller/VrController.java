package cn.com.rivercloud.controller;

import cn.com.rivercloud.bean.vo.PingTestVo;
import cn.com.rivercloud.service.VrInService;
import cn.com.rivercloud.service.VrService;
import cn.com.rivercloud.util.common.RequestUtil;
import cn.com.rivercloud.util.result.ApiPageModeResult;
import cn.com.rivercloud.util.result.Pagination;
import com.alibaba.fastjson.JSONObject;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;

/**
 * @author LiYutao
 * @date 2024/11/12
 * @description 北向接口
 */
@RestController
@RequestMapping("/V2/ctcontrol")
public class VrController {

    @Resource
    private VrService vrService;

    @Resource
    private VrInService vrInService;

    /**
     * 分页获取VR虚机
     * @param request
     * @param pageSize
     * @param pageNum
     * @return
     */
    @GetMapping("/VR1/pagelist")
    public JSONObject pageList(HttpServletRequest request,
                               @RequestParam(value = "page_size") Integer pageSize,
                               @RequestParam(value = "page_num") Integer pageNum) {
        ApiPageModeResult result = RequestUtil.requestId(request);
        Pagination pagination = new Pagination();
        pagination.setCurrent(pageNum == null ? 1 : pageNum);
        pagination.setPageSize(pageSize == null ? 10 : pageSize);
        return vrService.pageList(result, pagination);
    }


    /**
     * 新增或更新VR配置信息
     * @param json
     * @return
     */
    @PostMapping("/VR2/VRConfig")
    public JSONObject vRConfig(HttpServletRequest request, @RequestBody String json) {
        ApiPageModeResult result = RequestUtil.requestId(request);
        return vrService.addVRConfig(result, json);
    }

    /**
     * 查看VR配置信息
     * @param uuid
     * @return
     */
    @GetMapping("/VR2/VRConfig")
    public JSONObject getVRConfig(HttpServletRequest request, String uuid) {
        ApiPageModeResult result = RequestUtil.requestId(request);
        return vrService.get(result, uuid);
    }

    /**
     * 删除VR配置信息
     * @param request
     * @param uuid
     * @return
     */
    @DeleteMapping("/VR2/VRConfig")
    public JSONObject deleteVRConfig(HttpServletRequest request, String uuid) {
        ApiPageModeResult result = RequestUtil.requestId(request);
        return vrService.deleteVRConfig(result, uuid);
    }

    /**
     * 获取VR配置和状态信息
     * @param request
     * @param uuid
     * @return
     */
    @GetMapping("/VR3/VRConfig/list")
    public JSONObject srv6List(HttpServletRequest request, @RequestParam(required = false) String uuid) {
        ApiPageModeResult result = RequestUtil.requestId(request);
        return vrInService.getConfigAndStatus(result, uuid);
    }

    @PostMapping("/ping/test")
    public JSONObject add(HttpServletRequest request, @RequestBody PingTestVo pingTestVo) {
        ApiPageModeResult result = RequestUtil.requestId(request);
        return vrService.pingTest(result, pingTestVo);
    }
}
