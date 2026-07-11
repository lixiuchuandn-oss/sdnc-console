package cn.com.rivercloud.service.impl;

import cn.com.rivercloud.bean.VrConfigAndStatusBean;
import cn.com.rivercloud.bean.VrDeviceBean;
import cn.com.rivercloud.bean.vo.PingTestVo;
import cn.com.rivercloud.bean.vo.VrDeviceVo;
import cn.com.rivercloud.config.validator.Srv6ConfigJsonValidator;
import cn.com.rivercloud.dao.VrConfigDao;
import cn.com.rivercloud.dao.VrConfigAndStatusDao;
import cn.com.rivercloud.dao.VrDao;
import cn.com.rivercloud.enums.PingTestEnum;
import cn.com.rivercloud.service.VrService;
import cn.com.rivercloud.util.agent.AgentTypeEnum;
import cn.com.rivercloud.util.agent.ExecuteUtil;
import cn.com.rivercloud.util.exception.ServiceException;
import cn.com.rivercloud.util.ip.CIDRUtils;
import cn.com.rivercloud.util.ip.IpValidateUtil;
import cn.com.rivercloud.util.ip.Ping;
import cn.com.rivercloud.util.response.CsmAgentResponseJson;
import cn.com.rivercloud.util.result.ApiPageDate;
import cn.com.rivercloud.util.result.ApiPageModeResult;
import cn.com.rivercloud.util.result.ApiResultCode;
import cn.com.rivercloud.util.result.Pagination;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.mongodb.QueryBuilder;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.apache.logging.log4j.util.Strings;
import org.bson.Document;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.net.UnknownHostException;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * @author LiYutao
 * @date 2024/11/12
 * @description
 */
@Slf4j
@Service
public class VrServiceImpl implements VrService {

    @Value("${vr.config.interfaces}")
    private String vrConfigInterfaces;

    @Value("${ipv4.vpn.config}")
    private String ipv4VpnConfig;

    @Value("${ipv6.vpn.config}")
    private String ipv6VpnConfig;

    @Resource
    private VrDao vrDao;

    @Resource
    private VrConfigDao vrConfigDao;

    @Resource
    private VrConfigAndStatusDao vrConfigAndStatusDao;

    @Resource
    private Srv6ConfigJsonValidator srv6ConfigJsonValidator;

    @Override
    public JSONObject pageList(ApiPageModeResult result, Pagination pagination) {
        List<VrDeviceBean> vrDeviceBeans = vrDao.search(pagination, QueryBuilder.start());
        List<VrDeviceVo> vos = new ArrayList<>();
        vrDeviceBeans.forEach(vrDeviceBean -> {
            VrDeviceVo vrDeviceVO = VrDeviceBeanToVO(vrDeviceBean);
            vos.add(vrDeviceVO);
        });
        ApiPageDate apiPageDate = new ApiPageDate(pagination.getPageSize(), pagination.getCurrent());
        apiPageDate.setPage(vos);
        apiPageDate.setTotal(vrDao.searchCount(QueryBuilder.start()));
        return result.data(apiPageDate).build();
    }

    @Override
    public JSONObject get(ApiPageModeResult result, String uuid) {
        Document document = vrConfigDao.get(uuid);
        if (document == null) {
            throw new ServiceException(
                    String.valueOf(ApiResultCode.NULL_SRV6_CONFIG.code()), ApiResultCode.NULL_SRV6_CONFIG.message());
        }
        return result.data(JSONObject.parseObject(document.toJson())).msg("查询VR配置成功").build();
    }

    @Override
    public JSONObject pingTest(ApiPageModeResult result, PingTestVo pingTestVo) {
        String identIp = pingTestVo.getIdent_ip();
        String targetIp = pingTestVo.getTarget_ip();
        if (Strings.isEmpty(identIp) || !IpValidateUtil.isIp(identIp)) {
            log.error(ApiResultCode.VPN93016.message());
            return result.code(ApiResultCode.VPN93016.code()).msg(ApiResultCode.VPN93016.getMessage(identIp)).build();
        }
        if (Strings.isEmpty(targetIp) || !IpValidateUtil.isIp(targetIp)) {
            log.error(ApiResultCode.VPN93017.message());
            return result.code(ApiResultCode.VPN93017.code()).msg(ApiResultCode.VPN93017.getMessage(identIp)).build();
        }
        // 先校验identIP是否可达
        boolean ok = Ping.isOk(identIp);
        if (!ok) {
            return result.code(ApiResultCode.VPN93018.code()).msg(ApiResultCode.VPN93018.getMessage(identIp)).build();
        }
        String val = PingTestEnum.OK.getVal();
        CsmAgentResponseJson execute = ExecuteUtil.execute(Collections.singletonList("ping " + targetIp + " -w 2 -c 30"),
                identIp, AgentTypeEnum.CSM_AGENT.getPort());
        if (!execute.isSuccess() || execute.getData().contains("100% packet loss")) {
            val = PingTestEnum.UNREACHABLE.getVal();
        }
        Map<String, String> responseMap = new HashMap<>();
        responseMap.put("ping_result", val);
        return result.data(responseMap).build();
    }

    @Override
    public JSONObject addVRConfig(ApiPageModeResult result, String json) {
        // 校验json的格式
        srv6ConfigJsonValidator.validate(json);
        // 进一步校验业务规则
        checkVrfAndInterface(json);
        checkIpRoute(json);
        checkBgp(json);
        checkSegmentRoutingSrv6(json);
        boolean exists = vrConfigDao.add(json);
        String msg = exists ? "更新VR配置成功" : "新增VR配置成功";
        return result.data(new JSONObject()).msg(msg).build();
    }

    @Override
    public JSONObject deleteVRConfig(ApiPageModeResult result, String uuid) {
        Document document = vrConfigDao.get(uuid);
        if (document == null) {
            throw new ServiceException(
                    String.valueOf(ApiResultCode.NULL_SRV6_CONFIG.code()), ApiResultCode.NULL_SRV6_CONFIG.message());
        }
        vrConfigDao.delete(uuid);
        return result.data(new JSONObject()).msg("VR配置删除成功").build();
    }

    /**
     * 校验vrf和interface
     * @param json 用户提交的json数据
     */
    private void checkVrfAndInterface(String json) {
        JSONObject jsonObject = JSONObject.parseObject(json);
        JSONArray vrf = jsonObject.containsKey("vrf") ? jsonObject.getJSONArray("vrf") : new JSONArray();
        JSONArray outVrRps = jsonObject.containsKey("vrrp") ? jsonObject.getJSONArray("vrrp") : new JSONArray();
        Set<Integer> vrIds = new HashSet<>();
        List<JSONObject> checkIpSegmentList = new ArrayList<>();
        List<JSONObject> checkIpSegmentListNoVrf = new ArrayList<>();
        List<String> srv6InterfaceNames = getSrv6InterfaceNames(jsonObject);
        Arrays.asList(vrConfigInterfaces.split(",")).forEach(vrConfigInterface -> {
            if (jsonObject.containsKey(vrConfigInterface)) {
                JSONArray vrInterfaces = jsonObject.getJSONArray(vrConfigInterface);
                for (int i = 0; i < vrInterfaces.size(); i++) {
                    JSONObject vrInterface = vrInterfaces.getJSONObject(i);
                    if (vrInterface.containsKey("vrf")) {
                        checkIpSegmentList.add(vrInterface);
                        if (!vrf.contains(vrInterface.getInteger("vrf"))) {
                            throw new ServiceException(
                                    String.valueOf(ApiResultCode.VM19000.code()), "接口中只能使用vrf中已定义的");
                        }
                    } else {
                        checkIpSegmentListNoVrf.add(vrInterface);
                    }
                    // 校验接口的名称是否符合规范
                    checkVrfInterfaceName(vrInterface, srv6InterfaceNames, vrConfigInterface);
                    // 校验接口中的vrrp中的vrid是否重复
                    checkVrId(vrIds, vrInterface);
                }
            }
        });
        checkOutVrRp(vrIds, outVrRps);
        // 校验配置相同vrf的接口是否处于同一网段
        Map<Integer, List<JSONObject>> groupByVrf = checkIpSegmentList.stream().collect(Collectors.groupingBy(
                        checkIpSegment -> checkIpSegment.getInteger("vrf"), Collectors.toList()));
        groupByVrf.forEach((k, v) -> sameSegment(v, true, k));
        sameSegment(checkIpSegmentListNoVrf, false, null);
    }

    /**
     * 查询底层上报的接口信息
     * @param jsonObject
     * @return
     */
    private List<String> getSrv6InterfaceNames(JSONObject jsonObject) {
        VrConfigAndStatusBean exists = vrConfigAndStatusDao.findByUuId(jsonObject.getString("uuid"));
        List<String> srv6InterfaceNames = new ArrayList<>();
        if (exists != null) {
            exists.getInterfaces().forEach(srv6Interface -> srv6InterfaceNames.add(srv6Interface.getName()));
        }
        return srv6InterfaceNames;
    }

    /**
     * 校验路由
     * @param json
     */
    private void checkIpRoute(String json) {
        JSONObject jsonObject = JSONObject.parseObject(json);
        List<String> srv6InterfaceNames = getSrv6InterfaceNames(jsonObject);
        // 配置的vrf
        JSONArray vrf = jsonObject.containsKey("vrf") ? jsonObject.getJSONArray("vrf") : new JSONArray();
        if (jsonObject.containsKey("ipv4_route")) {
            JSONArray ipv4Routes = jsonObject.getJSONArray("ipv4_route");
            checkRouteDetail(ipv4Routes, srv6InterfaceNames, vrf, 4);
        }
        if (jsonObject.containsKey("ipv6_route")) {
            JSONArray ipv6Routes = jsonObject.getJSONArray("ipv6_route");
            checkRouteDetail(ipv6Routes, srv6InterfaceNames, vrf, 6);
        }
    }

    /**
     * 校验静态路由中的via、destination、dev、vrf等是否符合业务规则
     * @param ipvRoutes
     * @param srv6InterfaceNames
     * @param vrf
     * @param type
     */
    private void checkRouteDetail(JSONArray ipvRoutes, List<String> srv6InterfaceNames, JSONArray vrf, Integer type) {
        for (int i = 0; i < ipvRoutes.size(); i++) {
            JSONObject ipvRoute = ipvRoutes.getJSONObject(i);
            if (ipvRoute.containsKey("via")) {
                String via = ipvRoute.getString("via");
                if (!"nexthop-vrf 0".equals(via) && checkIpv4OrIpv6NoMask(via, type)) {
                    throw new ServiceException(
                            String.valueOf(ApiResultCode.VM19000.code()),
                            "ipv" + type + "_route中的via必须是合法的ipv" + type + "地址且不能加掩码");
                }
            }
            if (ipvRoute.containsKey("destination")) {
                if (checkIpPattern(ipvRoute.getString("destination"), type)) {
                    throw new ServiceException(
                            String.valueOf(ApiResultCode.VM19000.code()),
                            "ipv" + type + "_route中的destination必须是合法的ipv" + type + "地址且必须加掩码");
                }
            }
            if (ipvRoute.containsKey("dev")) {
                String dev = ipvRoute.getString("dev");
                if (!srv6InterfaceNames.contains(ipvRoute.getString("dev"))) {
                    throw new ServiceException(String.valueOf(ApiResultCode.VM19000.code()),
                            dev + "不在已上报的接口中");
                }
            }
            if (ipvRoute.containsKey("vrf")) {
                Integer ipvRouteVrf = ipvRoute.getInteger("vrf");
                if (!vrf.contains(ipvRouteVrf)) {
                    throw new ServiceException(String.valueOf(ApiResultCode.VM19000.code()),
                            ipvRouteVrf + "不在全局配置的vrf中");
                }
            }
        }
    }

    /**
     * 校验接口中的vrrp中的vrid是否重复
     * @param vrIds
     * @param vrInterface
     */
    private void checkVrId(Set<Integer> vrIds, JSONObject vrInterface) {
        if (vrInterface.containsKey("vrrp")) {
            JSONArray vrRps = vrInterface.getJSONArray("vrrp");
            for (int i = 0; i < vrRps.size(); i++) {
                JSONObject vrRp = vrRps.getJSONObject(i);
                if (vrRp.containsKey("vrid")) {
                    if (!vrIds.add(vrRp.getInteger("vrid"))) {
                        throw new ServiceException(
                                String.valueOf(ApiResultCode.VM19000.code()), "所有接口的vrrp中的vrid不能重复");
                    }
                }
                // 在接口下配置vrrp 时virtual_ipaddress 携带的参数要必填,且地址必须携带掩码
                if (!vrRp.containsKey("virtual_ipaddress")) {
                    throw new ServiceException(
                            String.valueOf(ApiResultCode.VM19000.code()), "在接口下配置vrrp时virtual_ipaddresss是必填项");
                }
                JSONArray virtualIpaddress = vrRp.getJSONArray("virtual_ipaddress");
                for (int j = 0; j < virtualIpaddress.size(); j++) {
                    String virtualIp = virtualIpaddress.getString(j);
                    String[] split = virtualIp.split(" ");
                    for (String s : split) {
                        if (checkIpPattern(s, 4)) {
                            throw new ServiceException(
                                    String.valueOf(ApiResultCode.VM19000.code()),
                                    "virtual_ipaddress必须符合ipv4加掩码的格式");
                        }
                    }
                }
                if (vrRp.containsKey("auth_pass")) {
                    String authPass = vrRp.getString("auth_pass");
                    if (!StringUtils.isNumeric(authPass) || authPass.length() > 10) {
                        throw new ServiceException(
                                String.valueOf(ApiResultCode.VM19000.code()),
                                "接口下配置vrrp中的auth_pass时，只能为数字，且最多10个数字");
                    }
                }
            }
        }
    }

    /**
     * 校验最外层的vrrp
     * @param outVrRps
     */
    private void checkOutVrRp(Set<Integer> vrIds, JSONArray outVrRps) {
        Set<Integer> groupIds = new HashSet<>();
        for (int i = 0; i < outVrRps.size(); i++) {
            JSONObject outVrRp = outVrRps.getJSONObject(i);
            if (outVrRp.containsKey("group_id")) {
                if (!groupIds.add(outVrRp.getInteger("group_id"))) {
                    throw new ServiceException(
                            String.valueOf(ApiResultCode.VM19000.code()), "最外层vrrp中group_id不能重复");
                }
            }
            if (outVrRp.containsKey("vrrp_instance")) {
                JSONArray vrRpInstance = outVrRp.getJSONArray("vrrp_instance");
                for (int j = 0; j < vrRpInstance.size(); j++) {
                    Integer instanceId = vrRpInstance.getInteger(j);
                    if (!vrIds.contains(instanceId)) {
                        throw new ServiceException(
                                String.valueOf(ApiResultCode.VM19000.code()),
                                "最外层vrrp中vrrp_instance是接口中的vrid，接口先配置，才能在vrrp中有");
                    }
                }
            }
            // 在vrrp group 中配置track_gateway 中地址不可以携带掩码
            if (outVrRp.containsKey("track_gateway")) {
                JSONArray trackGateways = outVrRp.getJSONArray("track_gateway");
                for (int j = 0; j < trackGateways.size(); j++) {
                    String trackGateway = trackGateways.getString(j);
                    if (checkIpv4OrIpv6NoMask(trackGateway, 4)) {
                        throw new ServiceException(
                                String.valueOf(ApiResultCode.VM19000.code()),
                                "在vrrp group中配置track_gateway的ipv4地址必须合法且不可以携带掩码");
                    }
                }
            }
        }
    }

    /**
     * 校验接口的名称
     * @param vrInterface 每一个接口
     * @param srv6InterfaceNames 从vr_controller_srv6表中查询出来的数据
     * @param vrConfigInterface 配置文件中配置的接口名称
     */
    private void checkVrfInterfaceName(
            JSONObject vrInterface, List<String> srv6InterfaceNames, String vrConfigInterface) {
        if (vrInterface.containsKey("name")) {
            String name = vrInterface.getString("name");
            // 校验接口的名称是否符合规则
            if (Arrays.asList(
                    "interfaces_BondEthernet",
                    "interfaces_TapEthernet",
                    "interfaces_Tunnel").contains(vrConfigInterface)) {
                // eg: BondEthernet 1
                int serialNumber = Integer.parseInt(name.split(" ")[1]);
                if (serialNumber < 1 || serialNumber > 9999) {
                    throw new ServiceException(
                            String.valueOf(ApiResultCode.VM19000.code()),
                            name + "的序列号只能是1到9999的正整数");
                }
            } else if (Arrays.asList(
                    "subinterfaces_BondEthernet",
                    "subinterfaces_TapEthernet",
                    "subinterfaces_Tunnel").contains(vrConfigInterface)) {
                // eg: BondEthernet 2.1
                String serialNumber = name.split(" ")[1];
                if (!serialNumber.contains(".")) {
                    throw new ServiceException(
                            String.valueOf(ApiResultCode.VM19000.code()),
                            name + "的序列号中必须包含.");
                }
                String[] split = serialNumber.split("\\.");
                if (split.length != 2) {
                    throw new ServiceException(
                            String.valueOf(ApiResultCode.VM19000.code()),
                            name + "的序列号中必须是类似于*.*的形式");
                }
                if (Integer.parseInt(split[0]) < 0 || Integer.parseInt(split[1]) < 0
                        || Integer.parseInt(split[0]) > 99999 || Integer.parseInt(split[1]) > 99999) {
                    throw new ServiceException(
                            String.valueOf(ApiResultCode.VM19000.code()),
                            name + "的序列号只能是1到99999的正整数");
                }
            } else if (Arrays.asList(
                    "interfaces_memif",
                    "interfaces_GigabitEthernet",
                    "interfaces_lo").contains(vrConfigInterface)) {
                if (!srv6InterfaceNames.contains(name)) {
                    throw new ServiceException(String.valueOf(ApiResultCode.VM19000.code()),
                            name + "不在已上报的接口中");
                }
            } else if (Arrays.asList(
                    "subinterfaces_memif",
                    "subinterfaces_GigabitEthernet").contains(vrConfigInterface)) {
                if (!srv6InterfaceNames.contains(name.split("\\.")[0])) {
                    throw new ServiceException(String.valueOf(ApiResultCode.VM19000.code()),
                            name + "不是已上报接口下面的子接口");
                }
                String suffix = name.split("\\.")[1];
                if (Integer.parseInt(suffix) < 1 || Integer.parseInt(suffix) > 999999) {
                    throw new ServiceException(String.valueOf(ApiResultCode.VM19000.code()),
                            name + "的序列号只能是1到999999的正整数");
                }
            }
        }
    }

    /**
     * 校验配置相同vrf的接口是否处于同一网段
     * @param vrInterfaces
     */
    private void sameSegment(List<JSONObject> vrInterfaces, boolean hasVrf, Integer vrfId) {
        List<String> ipv4s = new ArrayList<>();
        List<String> ipv6s = new ArrayList<>();
        vrInterfaces.forEach(vrInterface -> {
            String ipv4Static = vrInterface.getString("ipv4_static");
            String ipv6Static = vrInterface.getString("ipv6_static");
            if (StringUtils.isNotEmpty(ipv4Static)) {
                // 必须是ip加掩码的方式，不然就提示
                if (checkIpPattern(ipv4Static, 4)) {
                    throw new ServiceException(
                            String.valueOf(ApiResultCode.VM19000.code()),
                            "接口中配置的ipv4_static只能合法且带掩码的ipv4地址");
                }
                ipv4s.add(ipv4Static);
            }
            if (StringUtils.isNotEmpty(ipv6Static)) {
                if (checkIpPattern(ipv6Static, 6)) {
                    throw new ServiceException(
                            String.valueOf(ApiResultCode.VM19000.code()),
                            "接口中配置的ipv6_static只能合法且带掩码的ipv6地址");
                }
                ipv6s.add(ipv6Static);
            }
        });
        try {
            if (CIDRUtils.hasOverlap(ipv4s)) {
                String msg;
                if (hasVrf) {
                    msg = "vrf为" + vrfId + "的接口中的ipv4地址不能是同一网段的";
                } else {
                    msg = "未配置vrf的接口中的ipv4地址不能是同一网段的";
                }
                throw new ServiceException(String.valueOf(ApiResultCode.VM19000.code()), msg);
            }
            if (CIDRUtils.hasOverlap(ipv6s)) {
                String msg;
                if (hasVrf) {
                    msg = "vrf为" + vrfId + "的接口中的ipv6地址不能是同一网段的";
                } else {
                    msg = "未配置vrf的接口中的ipv6地址不能是同一网段的";
                }
                throw new ServiceException(String.valueOf(ApiResultCode.VM19000.code()), msg);
            }
        } catch (UnknownHostException e) {
            throw new ServiceException(e);
        }
    }

    /**
     * 1、不管删除哪个segment_routing_srv6 ，判断是否有auto_assign_sid  如果有就提示
     * 2、第一次下的公共的segment_routing_srv6 和公网segment_routing_srv6，没有下auto_assign_sid
     * 第二次直接删除公共的不允许删，得先删除公网的segment_routing_srv6
     * @param json
     */
    private void checkSegmentRoutingSrv6(String json) {
        JSONObject jsonObject = JSONObject.parseObject(json);
        checkOutSegmentRoutingSrv6(jsonObject);
        boolean containsOutSR6 = checkOutSegmentRoutingSrv6Exists(jsonObject);
        boolean containsInnerSR6 = checkInnerSegmentRoutingSrv6Exists(jsonObject);
        // 查询之前老的配置，对比现在和之前的配置，校验有没有删除任何位置的segment_routing_srv6
        boolean oldContainsOutSR6 = false;
        boolean oldContainsInnerSR6 = false;
        boolean oldAutoAssignSidExists = false;
        Document document = vrConfigDao.get(jsonObject.getString("uuid"));
        if (document != null) {
            JSONObject oldJsonObject = JSONObject.parseObject(document.toJson());
            oldContainsOutSR6 = checkOutSegmentRoutingSrv6Exists(oldJsonObject);
            oldContainsInnerSR6 = checkInnerSegmentRoutingSrv6Exists(oldJsonObject);
            oldAutoAssignSidExists = checkAutoAssignSidExists(oldJsonObject);
        }
        // 判断有没有删除任意位置的segment_routing_srv6
        boolean deleteSegmentRoutingSrv6 = (oldContainsOutSR6 && !containsOutSR6) || (oldContainsInnerSR6 && !containsInnerSR6);
        if (oldAutoAssignSidExists) {
            if (deleteSegmentRoutingSrv6) {
                // 判断配置中是否有auto_assign_sid，有的话就提示
                if (checkAutoAssignSidExists(jsonObject)) {
                    throw new ServiceException(
                            String.valueOf(ApiResultCode.VM19000.code()),
                            "删除segment_routing_srv6之前 ，请先删除auto_assign_sid");
                }
            }
        } else {
            if ((oldContainsOutSR6 && containsInnerSR6) && (!containsOutSR6 && oldContainsInnerSR6)) {
                throw new ServiceException(
                        String.valueOf(ApiResultCode.VM19000.code()),
                        "删除公共的segment_routing_srv6之前 ，请先公网下的segment_routing_srv6");
            }
        }
    }

    /**
     * 校验外层是否包含 segment_routing_srv6
     * @param jsonObject
     * @return
     */
    private boolean checkOutSegmentRoutingSrv6Exists(JSONObject jsonObject) {
        return jsonObject.containsKey("segment_routing_srv6");
    }

    /**
     * segment_routing_srv6中prefix是ipv6 地址 且不能携带掩码
     * @param jsonObject
     */
    private void checkOutSegmentRoutingSrv6(JSONObject jsonObject) {
        if (jsonObject.containsKey("segment_routing_srv6")) {
            JSONObject segmentRoutingSrv6 = jsonObject.getJSONObject("segment_routing_srv6");
            if (segmentRoutingSrv6.containsKey("prefix") &&
                    checkIpv4OrIpv6NoMask(segmentRoutingSrv6.getString("prefix"), 6)) {
                throw new ServiceException(
                        String.valueOf(ApiResultCode.VM19000.code()),
                        "segment_routing_srv6中prefix是ipv6 地址 且不能携带掩码");
            }
        }
    }

    /**
     * 校验内层是否包含 segment_routing_srv6
     * @param jsonObject
     */
    private boolean checkInnerSegmentRoutingSrv6Exists(JSONObject jsonObject) {
        if (jsonObject.containsKey("bgp")) {
            JSONArray bgps = jsonObject.getJSONArray("bgp");
            for (int i = 0; i < bgps.size(); i++) {
                JSONObject bgp = bgps.getJSONObject(i);
                if (!bgp.containsKey("vrf") && bgp.containsKey("segment_routing_srv6")) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 校验bgp的address_family中是否含有auto_assign_sid
     * @param jsonObject
     * @return
     */
    private boolean checkAutoAssignSidExists(JSONObject jsonObject) {
        if (jsonObject.containsKey("bgp")) {
            JSONArray bgps = jsonObject.getJSONArray("bgp");
            for (int i = 0; i < bgps.size(); i++) {
                JSONObject bgp = bgps.getJSONObject(i);
                if (bgp.containsKey("address_family")) {
                    JSONArray addressFamilies = bgp.getJSONArray("address_family");
                    for (int j = 0; j < addressFamilies.size(); j++) {
                        JSONObject addressFamily = addressFamilies.getJSONObject(j);
                        if (addressFamily.containsKey("auto_assign_sid")) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    public static void main(String[] args) {
        int a = 0;
        a++;
        System.out.println(a);
    }

    /**
     *      bgp 分为公网和私网 配置vrf的为私网 反之为公网
     * auto_assign_sid 使能只能在私网下面配置
     * segment_routing_srv6 只能在公网下面配置
     * ipv4 vpn 暂时只能配置activate_address_family
     * ipv6 vpn 整块暂时不支持
     * @param json
     */
    private void checkBgp(String json) {
        JSONObject jsonObject = JSONObject.parseObject(json);
        JSONArray vrf = jsonObject.containsKey("vrf") ? jsonObject.getJSONArray("vrf") : new JSONArray();
        Document document = vrConfigDao.get(jsonObject.getString("uuid"));
        boolean oldPublicBgp = false;
        if (document != null) {
            JSONObject oldJsonObject = JSONObject.parseObject(document.toJson());
            if (oldJsonObject.containsKey("bgp")) {
                JSONArray oldBgps = oldJsonObject.getJSONArray("bgp");
                for (int f = 0; f < oldBgps.size(); f++) {
                    JSONObject oldBgp = oldBgps.getJSONObject(f);
                    if (!oldBgp.containsKey("vrf")) {
                        oldPublicBgp = true;
                    }
                }
            }
        }
        Set<String> routeMapNames = new HashSet<>();
        if (jsonObject.containsKey("route_map")) {
            JSONArray routeMaps = jsonObject.getJSONArray("route_map");
            for (int f = 0; f < routeMaps.size(); f++) {
                JSONObject routeMap = routeMaps.getJSONObject(f);
                if (routeMap.containsKey("name")) {
                    routeMapNames.add(routeMap.getString("name"));
                }
            }
        }
        if (jsonObject.containsKey("bgp")) {
            JSONArray bgps = jsonObject.getJSONArray("bgp");
            boolean publicBgp = false;
            boolean privateBgp = false;
            int bgpNoVrfCount = 0;
            Set<Integer> vrfs = new HashSet<>();
            for (int i = 0; i < bgps.size(); i++) {
                JSONObject bgp = bgps.getJSONObject(i);
                if (bgp.containsKey("timer_bgp_KA") && bgp.containsKey("timer_bgp_HA")) {
                    Integer timerBgpKA = bgp.getInteger("timer_bgp_KA");
                    Integer timerBgpHA = bgp.getInteger("timer_bgp_HA");
                    if (timerBgpKA == 0) {
                        if (timerBgpHA < 3) {
                            throw new ServiceException(
                                    String.valueOf(ApiResultCode.VM19000.code()),
                                    "bgp中timer_bgp_KA为0时，timer_bgp_HA必须大于等于3");
                        }
                    } else {
                        if (timerBgpKA * 3 > timerBgpHA) {
                            throw new ServiceException(
                                    String.valueOf(ApiResultCode.VM19000.code()),
                                    "bgp中timer_bgp_HA 必须大于等于timer_bgp_KA的三倍");
                        }
                    }
                } else {
                    if ((bgp.containsKey("timer_bgp_KA") && !bgp.containsKey("timer_bgp_HA")) ||
                            (!bgp.containsKey("timer_bgp_KA") && bgp.containsKey("timer_bgp_HA"))) {
                        throw new ServiceException(
                                String.valueOf(ApiResultCode.VM19000.code()),
                                "bgp中timer_bgp_HA 和 timer_bgp_KA必须同时存在或者不存在");
                    }
                }
                // bgp 中router-id  地址只能是ipv4 且不带掩码
                if (bgp.containsKey("router_id")) {
                    if (checkIpv4OrIpv6NoMask(bgp.getString("router_id"), 4)) {
                        throw new ServiceException(
                                String.valueOf(ApiResultCode.VM19000.code()),
                                "bgp中router_id地址只能是ipv4且不带掩码");
                    }
                }
                if (bgp.containsKey("vrf")) {
                    boolean add = vrfs.add(bgp.getInteger("vrf"));
                    if (!add) {
                        throw new ServiceException(
                                String.valueOf(ApiResultCode.VM19000.code()),
                                "不同bgp中的vrf不能重复");
                    }
                    privateBgp = true;
                    // 私网
                    if (bgp.containsKey("segment_routing_srv6")) {
                        throw new ServiceException(
                                String.valueOf(ApiResultCode.VM19000.code()),
                                "segment_routing_srv6 只能在公网下面配置");
                    }
                    if (!vrf.contains(bgp.getInteger("vrf"))) {
                        throw new ServiceException(
                                String.valueOf(ApiResultCode.VM19000.code()),
                                bgp.getInteger("vrf") + "必须在全局配置的vrf中");
                    }
                } else {
                    publicBgp = true;
                    bgpNoVrfCount++;
                    // bgp不包含vrf
                    if (bgp.containsKey("segment_routing_srv6")) {
                        JSONObject segmentRoutingSrv6 = bgp.getJSONObject("segment_routing_srv6");
                        if (!jsonObject.containsKey("segment_routing_srv6")) {
                            throw new ServiceException(
                                    String.valueOf(ApiResultCode.VM19000.code()),
                                    "全局未配置segment_routing_srv6时在bgp下不允许配置segment_routing_srv6");
                        }
                        JSONObject overallSegmentRoutingSrv6  = jsonObject.getJSONObject("segment_routing_srv6");
                        String overallLocator = overallSegmentRoutingSrv6.getString("locator");
                        String locator = segmentRoutingSrv6.getString("locator");
                        if (!overallLocator.equals(locator)) {
                            throw new ServiceException(
                                    String.valueOf(ApiResultCode.VM19000.code()),
                                    "bgp下配置的segment_routing_srv6必须和全局配置segment_routing_srv6一致");
                        }
                    }
                }
                if (bgp.containsKey("address_family")) {
                    JSONArray addressFamilies = bgp.getJSONArray("address_family");
                    for (int j = 0; j < addressFamilies.size(); j++) {
                        JSONObject addressFamily = addressFamilies.getJSONObject(j);
                        // 私网bgp address_family中不能配置modifiler为vpn的参数 包括ipv4 和ipv6
                        if (bgp.containsKey("vrf")) {
                            if (addressFamily.containsKey("modifiler")) {
                                String modifiler = addressFamily.getString("modifiler");
                                if ("vpn".equals(modifiler)) {
                                    throw new ServiceException(
                                            String.valueOf(ApiResultCode.VM19000.code()),
                                            "私网bgp address_family中不能配置modifiler为vpn的参数 包括ipv4 和ipv6");
                                }
                            }
                        }
                        // 当未配置neighbor时不能配置activate_address_family
                        if (addressFamily.containsKey("activate_address_family")) {
                            // 将neighbor中的remote_ip放入集合
                            Set<String> remoteIps = new HashSet<>();
                            if (!bgp.containsKey("neighbor")) {
                                throw new ServiceException(
                                        String.valueOf(ApiResultCode.VM19000.code()),
                                        "当未配置neighbor时不能配置activate_address_family");
                            }
                            JSONArray neighbors = bgp.getJSONArray("neighbor");
                            if (neighbors.isEmpty()) {
                                throw new ServiceException(
                                        String.valueOf(ApiResultCode.VM19000.code()),
                                        "当未配置neighbor时不能配置activate_address_family");
                            }
                            for (int n = 0; n < neighbors.size(); n++) {
                                JSONObject neighbor = neighbors.getJSONObject(n);
                                String remoteIp = neighbor.getString("remote_ip");
                                if (checkIpv4OrIpv6NoMask(remoteIp, 4)
                                        && checkIpv4OrIpv6NoMask(remoteIp, 6)) {
                                    throw new ServiceException(
                                            String.valueOf(ApiResultCode.VM19000.code()),
                                            "neighbor中配置的remote_ip只能是不带掩码的ipv4或者ipv6地址");
                                }
                                remoteIps.add(remoteIp);
                            }
                            JSONArray activateAddressFamilies = addressFamily.getJSONArray("activate_address_family");
                            for (int q = 0; q < activateAddressFamilies.size(); q++) {
                                String activateAddressFamily = activateAddressFamilies.getString(q);
                                if(checkIpv4OrIpv6NoMask(activateAddressFamily, 6)) {
                                    throw new ServiceException(
                                            String.valueOf(ApiResultCode.VM19000.code()),
                                            "activate_address_family中必须是合法的ipv6地址且不带掩码");
                                }
                                if (!remoteIps.contains(activateAddressFamily)) {
                                    throw new ServiceException(
                                            String.valueOf(ApiResultCode.VM19000.code()),
                                            "activate_address_family中的地址必须存在于neighbor的remote_ip中");
                                }
                            }
                        }
                        if (addressFamily.containsKey("auto_assign_sid")) {
                            String autoAssignSid = addressFamily.getString("auto_assign_sid");
                            if ("enable".equals(autoAssignSid) && !bgp.containsKey("vrf")) {
                                throw new ServiceException(
                                        String.valueOf(ApiResultCode.VM19000.code()),
                                        "auto_assign_sid只能在私网下面配置为开启");
                            }
                        }
                        if (addressFamily.containsKey("address_family")) {
                            String addressFamilyProperty = addressFamily.getString("address_family");
                            if (addressFamily.containsKey("network")) {
                                JSONArray networks = addressFamily.getJSONArray("network");
                                for (int m = 0; m < networks.size(); m++) {
                                    String network = networks.getString(m);
                                    if ("ipv4".equals(addressFamilyProperty) && checkIpPattern(network, 4)) {
                                        throw new ServiceException(
                                                String.valueOf(ApiResultCode.VM19000.code()),
                                                "address_family为ipv4的network必须是ipv4地址加掩码的格式");
                                    }
                                    if ("ipv6".equals(addressFamilyProperty) && checkIpPattern(network, 6)) {
                                        throw new ServiceException(
                                                String.valueOf(ApiResultCode.VM19000.code()),
                                                "address_family为ipv6的network必须是ipv6地址加掩码的格式");
                                    }
                                }
                            }
                            if (addressFamily.containsKey("modifiler")) {
                                String modifiler = addressFamily.getString("modifiler");
                                if ("ipv4".equals(addressFamilyProperty) && "vpn".equals(modifiler)) {
                                    // ipv4 vpn 暂时只能配置activate_address_family
                                    Arrays.asList(ipv4VpnConfig.split(",")).forEach(otherProperty -> {
                                                if (addressFamily.containsKey(otherProperty)) {
                                                    throw new ServiceException(
                                                            String.valueOf(ApiResultCode.VM19000.code()),
                                                            "ipv4 vpn 暂时只能配置activate_address_family");
                                                }
                                    });
                                }
                                if ("ipv6".equals(addressFamilyProperty) && "vpn".equals(modifiler)) {
                                    // ipv6 vpn 整块暂时不支持
                                    Arrays.asList(ipv6VpnConfig.split(",")).forEach(otherProperty -> {
                                        if (addressFamily.containsKey(otherProperty)) {
                                            throw new ServiceException(
                                                    String.valueOf(ApiResultCode.VM19000.code()),
                                                    "ipv6 vpn 整块暂时不支持");
                                        }
                                    });
                                }
                            }
                            // bgp中route_distinguisher和route_target 携带字段格式为 A:B
                            if (addressFamily.containsKey("route_distinguisher")) {
                                checkAB(addressFamily.getString("route_distinguisher"));
                            }
                            // bgp中route_distinguisher和route_target 携带字段格式为 A:B
                            if (addressFamily.containsKey("route_target")) {
                                checkAB(addressFamily.getString("route_target"));
                            }
                        }
                        if (addressFamily.containsKey("neighbor_route_map")) {
                            JSONArray neighborRouteMaps = addressFamily.getJSONArray("neighbor_route_map");
                            for (int s = 0; s < neighborRouteMaps.size(); s++) {
                                JSONObject neighborRouteMap = neighborRouteMaps.getJSONObject(s);
                                Set<String> neighborRemoteIps = parseNeighborRemoteIp(bgp);
                                if (!neighborRemoteIps.contains(neighborRouteMap.getString("neighbor"))) {
                                    throw new ServiceException(
                                            String.valueOf(ApiResultCode.VM19000.code()),
                                            "neighbor_route_map中的neighbor必须是neighbor中remote_ip的地址");
                                }
                                if (!routeMapNames.contains(neighborRouteMap.getString("route_map"))) {
                                    throw new ServiceException(
                                            String.valueOf(ApiResultCode.VM19000.code()),
                                            "neighbor_route_map中的route_map必须是route_map中name的值");
                                }
                            }
                        }
                    }
                }
                if (bgp.containsKey("neighbor_disable_connected_check")) {
                    JSONArray neighborDisableConnectedCheck = bgp.getJSONArray("neighbor_disable_connected_check");
                    Set<String> parseNeighborRemoteIps = parseNeighborRemoteIp(bgp);
                    for (int q = 0; q < neighborDisableConnectedCheck.size(); q++) {
                        if (!parseNeighborRemoteIps.contains(neighborDisableConnectedCheck.getString(q))) {
                            throw new ServiceException(
                                    String.valueOf(ApiResultCode.VM19000.code()),
                                    "neighbor_disable_connected_check必须是neighbor中remote_ip的地址");
                        }
                    }
                }
            }
            // 不配置vrf的bgp 只能配置一个
            if (bgpNoVrfCount > 1) {
                throw new ServiceException(
                        String.valueOf(ApiResultCode.VM19000.code()),
                        "不配置vrf的bgp 只能配置一个");
            }
            // 相同的vrf bgp的asn 只能有一个
            // 不删除私网bgp 不能删除公网bgp
            if (oldPublicBgp && !publicBgp && privateBgp) {
                throw new ServiceException(
                        String.valueOf(ApiResultCode.VM19000.code()),
                        "不删除私网bgp 不能删除公网bgp");
            }
        }
    }

    /**
     * 解析neighbor中的remote_ip
     * @param bgp
     * @return
     */
    private Set<String> parseNeighborRemoteIp(JSONObject bgp) {
        Set<String> neighborRemoteIp = new HashSet<>();
        if (bgp.containsKey("neighbor")) {
            JSONArray neighbors = bgp.getJSONArray("neighbor");
            for (int m = 0; m < neighbors.size(); m++) {
                JSONObject neighbor = neighbors.getJSONObject(m);
                if (neighbor.containsKey("remote_ip")) {
                    neighborRemoteIp.add(neighbor.getString("remote_ip"));
                }
            }
        }
        return neighborRemoteIp;
    }

    private void checkAB(String checkData) {
        String message = "bgp中route_distinguisher和route_target 携带字段格式为A:B，A和B都是数字，并且位数加起来不超过10个数字";
        if (!checkData.contains(":")) {
            throw new ServiceException(String.valueOf(ApiResultCode.VM19000.code()), message);
        }
        String[] split = checkData.split(":");
        if (split.length != 2) {
            throw new ServiceException(String.valueOf(ApiResultCode.VM19000.code()), message);
        }
        if (!StringUtils.isNumeric(split[0]) || !StringUtils.isNumeric(split[1])) {
            throw new ServiceException(String.valueOf(ApiResultCode.VM19000.code()), message);
        }
        if (split[0].length() + split[1].length() > 10) {
            throw new ServiceException(String.valueOf(ApiResultCode.VM19000.code()), message);
        }
        int a = Integer.parseInt(split[0]);
        int b = Integer.parseInt(split[1]);
        if (a < 1 || a > 999999999 || b < 1 || b > 999999999) {
            throw new ServiceException(String.valueOf(ApiResultCode.VM19000.code()), message);
        }
    }

    /**
     * 校验是否符合ipv6和ipv6v4的格式
     * @param ip
     * @param type
     * @return
     */
    private boolean checkIpPattern(String ip, Integer type) {
        if (!ip.contains("/")) {
            return true;
        }
        String[] split = ip.split("/");
        if (split.length < 2) {
            return true;
        }
        String mask = split[1];
        if (Integer.parseInt(mask) < 0 || Integer.parseInt(mask) > 128) {
            return true;
        }
        return type == 4 ? !IpValidateUtil.isValidIpv4(split[0]) : !IpValidateUtil.isValidIpv6(split[0]);
    }

    private boolean checkIpv4OrIpv6NoMask(String ipNoMask, Integer type) {
        return type == 4
                ? !Pattern.compile("^(((\\d)|([1-9]\\d)|(1\\d{2})|(2[0-4]\\d)|(25[0-5]))\\.){3}((\\d)|([1-9]\\d)|(1\\d{2})|(2[0-4]\\d)|(25[0-5]))$").matcher(ipNoMask).matches()
                : !Pattern.compile("^(([0-9a-fA-F]{1,4}:){7}([0-9a-fA-F]{1,4}|:)|(([0-9a-fA-F]{1,4}:){1,7}:)|(([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4})|(([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2})|(([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3})|(([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4})|(([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5})|([0-9a-fA-F]{1,4}:)((:[0-9a-fA-F]{1,4}){1,6})|:(:(:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))$").matcher(ipNoMask).matches();
    }

    private VrDeviceVo VrDeviceBeanToVO(VrDeviceBean vrDeviceBean) {
        return VrDeviceVo.builder()
                .id(vrDeviceBean.getId())
                .uuid(vrDeviceBean.getUuid())
                .poolId(vrDeviceBean.getPoolId())
                .poolName(vrDeviceBean.getPoolName())
                .vmId(vrDeviceBean.getVmId())
                .mac(vrDeviceBean.getMac())
                .name(vrDeviceBean.getName())
                .version(vrDeviceBean.getVersion())
                .type(vrDeviceBean.getType())
                .healthStatus(vrDeviceBean.getHealthStatus())
                .resourceIndicators(vrDeviceBean.getResourceIndicators())
                .build();
    }
}
