package cn.com.rivercloud.util.result;


import cn.com.rivercloud.util.common.PubMethod;

/**
 * description: ResultCode <br> date: 2021/7/9 18:52 <br> version: 1.0 <br>
 *
 * @author 温高峰
 */
public enum ApiResultCode {
    //成功
    SUCCESS(200, "成功"),
    //失败
    FAILURE(0, "失败"),

    // 1xx Informational

    /**
     * {@code 100 Continue}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.2.1">HTTP/1.1:
     * Semantics and Content, section 6.2.1</a>
     */
    CONTINUE(100, "继续"),

    /**
     * {@code 101 Switching Protocols}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.2.2">HTTP/1.1:
     * Semantics and Content, section 6.2.2</a>
     */
    SWITCHING_PROTOCOLS(101, "切换协议"),

    /**
     * {@code 102 Processing}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc2518#section-10.1">WebDAV</a>
     */
    PROCESSING(102, "处理"),

    /**
     * {@code 103 Checkpoint}.
     *
     * @see <a href= "http://code.google.com/p/gears/wiki/ResumableHttpRequestsProposal">A proposal
     * for supporting resumable POST/PUT HTTP requests in HTTP/1.0</a>
     */
    CHECKPOINT(103, "检查点"),

    // 2xx Success

    /**
     * {@code 200 OK}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.3.1">HTTP/1.1:
     * Semantics and Content, section 6.3.1</a>
     */
    OK(200, "OK"),

    /**
     * {@code 201 Created}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.3.2">HTTP/1.1:
     * Semantics and Content, section 6.3.2</a>
     */
    CREATED(201, "创建"),

    /**
     * {@code 202 Accepted}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.3.3">HTTP/1.1:
     * Semantics and Content, section 6.3.3</a>
     */
    ACCEPTED(202, "接受"),

    /**
     * {@code 203 Non-Authoritative Information}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.3.4">HTTP/1.1:
     * Semantics and Content, section 6.3.4</a>
     */
    NON_AUTHORITATIVE_INFORMATION(203, "非权威信息"),

    /**
     * {@code 204 No Content}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.3.5">HTTP/1.1:
     * Semantics and Content, section 6.3.5</a>
     */
    NO_CONTENT(204, "无内容"),

    /**
     * {@code 205 Reset Content}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.3.6">HTTP/1.1:
     * Semantics and Content, section 6.3.6</a>
     */
    RESET_CONTENT(205, "重置内容"),

    /**
     * {@code 206 Partial Content}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7233#section-4.1">HTTP/1.1: Range
     * Requests, section 4.1</a>
     */
    PARTIAL_CONTENT(206, "部分内容"),

    /**
     * {@code 207 Multi-Status}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc4918#section-13">WebDAV</a>
     */
    MULTI_STATUS(207, "多状态"),

    /**
     * {@code 208 Already Reported}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc5842#section-7.1">WebDAV Binding
     * Extensions</a>
     */
    ALREADY_REPORTED(208, "已经报告"),

    /**
     * {@code 226 IM Used}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc3229#section-10.4.1">Delta
     * encoding in HTTP</a>
     */
    IM_USED(226, "IM 使用"),

    // 3xx Redirection

    /**
     * {@code 300 Multiple Choices}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.4.1">HTTP/1.1:
     * Semantics and Content, section 6.4.1</a>
     */
    MULTIPLE_CHOICES(300, "多种选择"),

    /**
     * {@code 301 Moved Permanently}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.4.2">HTTP/1.1:
     * Semantics and Content, section 6.4.2</a>
     */
    MOVED_PERMANENTLY(301, "永久移动"),

    /**
     * {@code 302 Found}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.4.3">HTTP/1.1:
     * Semantics and Content, section 6.4.3</a>
     */
    FOUND(302, "找到"),

    /**
     * {@code 302 Moved Temporarily}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc1945#section-9.3">HTTP/1.0,
     * section 9.3</a>
     * @deprecated in favor of {@link #FOUND} which will be returned from
     * {@code HttpStatus.valueOf(302)}
     */
    @Deprecated
    MOVED_TEMPORARILY(302, "Moved Temporarily"),

    /**
     * {@code 303 See Other}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.4.4">HTTP/1.1:
     * Semantics and Content, section 6.4.4</a>
     */
    SEE_OTHER(303, "见其他"),

    /**
     * {@code 304 Not Modified}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7232#section-4.1">HTTP/1.1:
     * Conditional Requests, section 4.1</a>
     */
    NOT_MODIFIED(304, "未修改"),

    /**
     * {@code 305 Use Proxy}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.4.5">HTTP/1.1:
     * Semantics and Content, section 6.4.5</a>
     * @deprecated due to security concerns regarding in-band configuration of a proxy
     */
    @Deprecated
    USE_PROXY(305, "使用代理"),

    /**
     * {@code 307 Temporary Redirect}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.4.7">HTTP/1.1:
     * Semantics and Content, section 6.4.7</a>
     */
    TEMPORARY_REDIRECT(307, "临时重定向"),

    /**
     * {@code 308 Permanent Redirect}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7238">RFC 7238</a>
     */
    PERMANENT_REDIRECT(308, "永久重定向"),

    // --- 4xx Client Error ---

    /**
     * {@code 400 Bad Request}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.5.1">HTTP/1.1:
     * Semantics and Content, section 6.5.1</a>
     */
    BAD_REQUEST(400, "错误请求："),

    PARAMS_ERROR(400, "参数错误："),

    /**
     * {@code 401 Unauthorized}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7235#section-3.1">HTTP/1.1:
     * Authentication, section 3.1</a>
     */
    UNAUTHORIZED(401, "未授权访问"),

    /**
     * {@code 402 Payment Required}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.5.2">HTTP/1.1:
     * Semantics and Content, section 6.5.2</a>
     */
    PAYMENT_REQUIRED(402, "需要付款"),

    /**
     * {@code 403 Forbidden}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.5.3">HTTP/1.1:
     * Semantics and Content, section 6.5.3</a>
     */
    FORBIDDEN(403, "禁止"),

    /**
     * {@code 404 Not Found}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.5.4">HTTP/1.1:
     * Semantics and Content, section 6.5.4</a>
     */
    NOT_FOUND(404, "未找到"),

    /**
     * {@code 405 Method Not Allowed}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.5.5">HTTP/1.1:
     * Semantics and Content, section 6.5.5</a>
     */
    METHOD_NOT_ALLOWED(405, "方法不允许"),

    /**
     * {@code 406 Not Acceptable}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.5.6">HTTP/1.1:
     * Semantics and Content, section 6.5.6</a>
     */
    NOT_ACCEPTABLE(406, "不可接受"),
    /**
     * {@code 407 Proxy Authentication Required}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7235#section-3.2">HTTP/1.1:
     * Authentication, section 3.2</a>
     */
    PROXY_AUTHENTICATION_REQUIRED(407, "需要代理验证"),

    /**
     * {@code 408 Request Timeout}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.5.7">HTTP/1.1:
     * Semantics and Content, section 6.5.7</a>
     */
    REQUEST_TIMEOUT(408, "请求超时"),

    /**
     * {@code 409 Conflict}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.5.8">HTTP/1.1:
     * Semantics and Content, section 6.5.8</a>
     */
    CONFLICT(409, "冲突"),

    /**
     * {@code 410 Gone}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.5.9">HTTP/1.1:
     * Semantics and Content, section 6.5.9</a>
     */
    GONE(410, "走了"),

    /**
     * {@code 411 Length Required}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.5.10">HTTP/1.1:
     * Semantics and Content, section 6.5.10</a>
     */
    LENGTH_REQUIRED(411, "所需长度"),

    /**
     * {@code 412 Precondition failed}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7232#section-4.2">HTTP/1.1:
     * Conditional Requests, section 4.2</a>
     */
    PRECONDITION_FAILED(412, "先决条件失败"),

    /**
     * {@code 413 Payload Too Large}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.5.11">HTTP/1.1:
     * Semantics and Content, section 6.5.11</a>
     * @since 4.1
     */
    PAYLOAD_TOO_LARGE(413, "请求实体太大"),

    /**
     * {@code 413 Request Entity Too Large}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc2616#section-10.4.14">HTTP/1.1,
     * section 10.4.14</a>
     * @deprecated in favor of {@link #PAYLOAD_TOO_LARGE} which will be returned from
     * {@code HttpStatus.valueOf(413)}
     */
    @Deprecated
    REQUEST_ENTITY_TOO_LARGE(413, "请求实体太大"),

    /**
     * {@code 414 URI Too Long}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.5.12">HTTP/1.1:
     * Semantics and Content, section 6.5.12</a>
     * @since 4.1
     */
    URI_TOO_LONG(414, "请求URI太长"),

    /**
     * {@code 414 Request-URI Too Long}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc2616#section-10.4.15">HTTP/1.1,
     * section 10.4.15</a>
     * @deprecated in favor of {@link #URI_TOO_LONG} which will be returned from
     * {@code HttpStatus.valueOf(414)}
     */
    @Deprecated
    REQUEST_URI_TOO_LONG(414, "请求URI太长"),

    /**
     * {@code 415 Unsupported Media Type}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.5.13">HTTP/1.1:
     * Semantics and Content, section 6.5.13</a>
     */
    UNSUPPORTED_MEDIA_TYPE(415, "不支持的媒体类型"),

    /**
     * {@code 416 Requested Range Not Satisfiable}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7233#section-4.4">HTTP/1.1: Range
     * Requests, section 4.4</a>
     */
    REQUESTED_RANGE_NOT_SATISFIABLE(416, "请求范围不满足"),

    /**
     * {@code 417 Expectation Failed}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.5.14">HTTP/1.1:
     * Semantics and Content, section 6.5.14</a>
     */
    EXPECTATION_FAILED(417, "期望失败"),

    /**
     * {@code 418 I'm a teapot}.
     *
     * @see <a href= "http://tools.ietf.org/html/rfc2324#section-2.3.2">HTCPCP/1.0</a>
     */
    I_AM_A_TEAPOT(418, "我是茶壶"),

    /**
     * @deprecated See <a href=
     * "http://tools.ietf.org/rfcdiff?difftype=--hwdiff&url2=draft-ietf-webdav-protocol-06.txt">WebDAV
     * Draft Changes</a>
     */
    @Deprecated
    INSUFFICIENT_SPACE_ON_RESOURCE(419, "资源空间不足"),

    /**
     * @deprecated See <a href=
     * "http://tools.ietf.org/rfcdiff?difftype=--hwdiff&url2=draft-ietf-webdav-protocol-06.txt">WebDAV
     * Draft Changes</a>
     */
    @Deprecated
    METHOD_FAILURE(420, "方法失效"),

    /**
     * @deprecated See <a href=
     * "http://tools.ietf.org/rfcdiff?difftype=--hwdiff&url2=draft-ietf-webdav-protocol-06.txt">WebDAV
     * Draft Changes</a>
     */
    @Deprecated
    DESTINATION_LOCKED(421, "目的地锁定"),

    /**
     * {@code 422 Unprocessable Entity}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc4918#section-11.2">WebDAV</a>
     */
    UNPROCESSABLE_ENTITY(422, "无法处理的实体"),

    /**
     * {@code 423 Locked}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc4918#section-11.3">WebDAV</a>
     */
    LOCKED(423, "锁定的"),

    /**
     * {@code 424 Failed Dependency}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc4918#section-11.4">WebDAV</a>
     */
    FAILED_DEPENDENCY(424, "依赖失败"),

    /**
     * {@code 426 Upgrade Required}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc2817#section-6">Upgrading to TLS
     * Within HTTP/1.1</a>
     */
    UPGRADE_REQUIRED(426, "需要升级"),

    /**
     * {@code 428 Precondition Required}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc6585#section-3">Additional HTTP
     * Status Codes</a>
     */
    PRECONDITION_REQUIRED(428, "要求先决条件"),

    /**
     * {@code 429 Too Many Requests}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc6585#section-4">Additional HTTP
     * Status Codes</a>
     */
    TOO_MANY_REQUESTS(429, "请求太多"),

    /**
     * {@code 431 Request Header Fields Too Large}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc6585#section-5">Additional HTTP
     * Status Codes</a>
     */
    REQUEST_HEADER_FIELDS_TOO_LARGE(431, "请求头字段太大"),

    /**
     * {@code 451 Unavailable For Legal Reasons}.
     *
     * @see <a href= "https://tools.ietf.org/html/draft-ietf-httpbis-legally-restricted-status-04"> An
     * HTTP Status Code to Report Legal Obstacles</a>
     * @since 4.3
     */
    UNAVAILABLE_FOR_LEGAL_REASONS(451, "因法律原因无法获得"),

    // --- 5xx Server Error ---

    /**
     * {@code 500 Internal Server Error}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.6.1">HTTP/1.1:
     * Semantics and Content, section 6.6.1</a>
     */
    INTERNAL_SERVER_ERROR(500, "内部服务错误。"),

    /**
     * {@code 501 Not Implemented}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.6.2">HTTP/1.1:
     * Semantics and Content, section 6.6.2</a>
     */
    NOT_IMPLEMENTED(501, "未实施"),

    /**
     * {@code 502 Bad Gateway}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.6.3">HTTP/1.1:
     * Semantics and Content, section 6.6.3</a>
     */
    BAD_GATEWAY(502, "错误网关"),

    /**
     * {@code 503 Service Unavailable}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.6.4">HTTP/1.1:
     * Semantics and Content, section 6.6.4</a>
     */
    SERVICE_UNAVAILABLE(503, "服务不可用"),

    /**
     * {@code 504 Gateway Timeout}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.6.5">HTTP/1.1:
     * Semantics and Content, section 6.6.5</a>
     */
    GATEWAY_TIMEOUT(504, "网关超时"),

    /**
     * {@code 505 HTTP Version Not Supported}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc7231#section-6.6.6">HTTP/1.1:
     * Semantics and Content, section 6.6.6</a>
     */
    HTTP_VERSION_NOT_SUPPORTED(505, "不支持HTTP版本"),

    /**
     * {@code 506 Variant Also Negotiates}
     *
     * @see <a href="http://tools.ietf.org/html/rfc2295#section-8.1">Transparent
     * Content Negotiation</a>
     */
    VARIANT_ALSO_NEGOTIATES(506, "变型也谈判"),

    /**
     * {@code 507 Insufficient Storage}
     *
     * @see <a href="http://tools.ietf.org/html/rfc4918#section-11.5">WebDAV</a>
     */
    INSUFFICIENT_STORAGE(507, "存储不足"),

    /**
     * {@code 508 Loop Detected}
     *
     * @see <a href="http://tools.ietf.org/html/rfc5842#section-7.2">WebDAV Binding
     * Extensions</a>
     */
    LOOP_DETECTED(508, "回路检测"),

    /**
     * {@code 509 Bandwidth Limit Exceeded}
     */
    BANDWIDTH_LIMIT_EXCEEDED(509, "超出带宽限制"),

    /**
     * {@code 510 Not Extended}
     *
     * @see <a href="http://tools.ietf.org/html/rfc2774#section-7">HTTP Extension
     * Framework</a>
     */
    NOT_EXTENDED(510, "未扩展"),

    /**
     * {@code 511 Network Authentication Required}.
     *
     * @see <a href="http://tools.ietf.org/html/rfc6585#section-6">Additional HTTP
     * Status Codes</a>
     */
    NETWORK_AUTHENTICATION_REQUIRED(511, "需要网络认证"),

    //页面嵌入的错误码
    DSLOG1001(1001, "未配置日志审计的IP或端口，还请去[管理]->[平台配置]->[系统配置]下进行配置."),
    DSLOG1002(1002, "访问日志审计失败,还请检查配置是否正确或对应日志审计服务是否正常"),
    DSLOG1003(1003, "未配置平台IP或端口,还请去[管理]->[平台配置]->[系统配置]下进行配置."),

    //参数校验,通用
    P10001(10001, "tonce字段缺失"),
    P10002(10002, "tonce时间戳超时"),
    P10003(10003, "Authorization字段缺失"),
    P10004(10004, "Authorization字段错误"),
    P10005(10005, "未授权访问，signature_hash数字签名不一致"),
    P10006(10006, "pool_id不能为空"),
    P10007(10007, "pool_id不存在"),
    P10008(10008, "host_id不能为空"),
    P10009(10009, "host_id不存在"),
    P10010(10010, "image_id不能为空"),
    P10011(10011, "image_id不存在"),
    P10012(10012, "template_id不能为空"),
    P10013(10013, "template_id不存在"),
    P10014(10014, "vm_id不能为空"),
    P10015(10015, "vm_id不存在"),
    P10016(10016, "vm_group_id不能为空"),
    P10017(10017, "vm_group_id不存在"),
    P10018(10018, "customer_id不能为空"),
    P10019(10019, "customer_id不存在资产"),

    //主机管理
    H20001(20001, "主机数据不存在"),
    H20002(20002, "主机下存在虚拟机"),
    H20003(20003, "主机下存在网络数据"),
    H20004(20004, "主机下存在VSW数据"),
    H20005(20005, "主机下存在网际路由数据"),
    H20006(20006, "主机下存在存储池数据"),
    H20007(20007, "主机下存在基础服务数据"),

    P10020(10020, "地址池不能为空"),
    P10021(10021, "地址池不存在"),
    P10022(10022, "IP不能为空"),
    P10023(10023, "IP不在地址池内"),
    P10024(10024, "${s},IP已被占用"),
    P10025(10025, "设备id不能为空"),

    // DHCP地址池
    D11000(11000, "地址池名称不能为空!"),
    D11001(11001, "${s} 地址池名称规则不合法! 仅支持数字、中文、英文，不区分大小写。"),
    D11002(11002, "${s} 地址池名称已存在!"),
    D11003(11003, "地址池IP集合不能为空!"),
    D11004(11004, "地址池IPmode不合法!支持的mode为ips、range!"),
    D11005(11005, "IP = ${s} 不合法!"),
    D11006(11006, "IP集合不是有效的range格式!"),
    D11007(11007, "IP集合中 ${s1} 不在有效范围 ${s2} -255内!"),
    D11008(11008, "IP集合中 ${s} IP重复!"),
    D11009(11009, "IP集合中与已存在地址池的 ${s} IP重复!"),
    D11010(11010, "例外IP = ${s} 必须存在于IP集合中!"),
    D11011(11011, "id = ${s} 地址池id不存在!"),
    D11012(11012, "地址池被网络引用后不能修改之前已有的地址!"),
    D11013(11013, "网关地址不不合法!"),
    D11014(11014, "目的网络不不合法!"),
    D11015(11015, "掩码不不合法!"),
    D11016(11016, "下一跳地址不不合法!"),
    D11017(11017, "例外地址池IP集合中 ${s} IP重复!"),
    D11018(11018, "未配置dhcp server!"),
    D11019(11019, "dhcp server 连通性测试失败!"),
    D11020(11020, "子网不能为空!"),
    D11021(11021, "ip集合必须在子网范围内!"),
    D11022(11022, "子网格式不合法!"),
    D11023(11023, "网关地址必须在子网范围内!"),
    D11024(11024, "历史数据缺少子网信息，请联系管理员!"),
    D11025(11025, "已存在该子网的地址池!"),


    //模板管理
    T30001(30001, "template_id重复"),
    T30002(30002, "template_name名称重复"),
    T30003(30003, "cpu不能为空"),
    T30004(30004, "memory不能为空"),
    T30005(30005, "dev_disk不能为空"),
    T30006(30006, "type类型不能为空"),
    T30007(30007, "type类型必须为system 或 data"),
    T30008(30008, "size不能为空"),
    T30009(30009, "interface_count不能为空"),
    T30010(30010, "interface_count必须大于等于3"),
    T30011(30011, "template_name不能为空"),
    T30012(30012, "dev_disk中缺少系统盘，请添加一个系统盘"),
    T30013(30013, "dev_disk中只能有一个系统盘"),
    T30014(30014, "template_name中不能包含#"),
    T30015(30015, "由于该镜像的初始化系统盘大小为${s} GB，所以添加镜像规格模板时，其系统盘大小必须大于等于${s} GB"),
    //虚机管理
    V40001(40001, "vm_name不能为空"),
    V40002(40002, "vm_name名称重复"),
    V40003(40003, "vm_defend_type不能为空"),
    V40004(40004, "vm_defend_type必须为1或2"),
    V40005(40005, "虚机的vm_defend_type和主机的host_defend_type不一致"),
    V40006(40006, "选择的主机不支持CPU绑定，请重新选择一个支持CPU绑定的主机"),
    V40007(40007, "找不到可以绑定的CPU"),
    V40008(40008, "对应主机上无对应镜像或镜像出现错误"),
    V40009(40009, "manage_ip不能为空"),
    V40010(40010, "manage_ip格式不对"),
    V40011(40011, "该虚机在主机上不存在"),
    V40012(40012, "该虚机已在虚机组内，请先从虚机组内摘除该虚机!"),
    V40013(40013, "manage_ip已存在"),
    V40014(40014, "虚机Id已存在"),
    V40015(40015, "vm_name中不能包含#"),
    V40016(40016, "主机未开启DHCP Server，请先开启主机的DHCP Server然后再试"),
    V40017(40017, "${s}地址池中没有足够的IP可进行分配，建议扩容地址池，或修改虚机配置IP方式"),

    //如下给WEB前端用
    V40018(40018, "虚机Id不存在"),
    V40019(40019, "configIpMode不能为空"),
    V40020(40020, "configIpMode不在范围内，请设置为static或dhcp"),
    V40021(40021, "虚机IP为DHCP分配或静态IP分配，不可进行IP的修改"),
    V40022(40022, "存在接口MAC为空"),
    V40023(40023, "${s}没有对应MAC的网卡"),
    V40024(40024, "${s}存在MAC一样的网卡"),
    V40025(40025, "该虚机为云服务器密码机，不能作为共享网元使用"),
    V40026(40026, "虚机所选择的磁盘存储类型和镜像中的存储类型不一致"),
    V40027(40027, "对应镜像没有imageStorageType属性"),
    V40028(40028, "不支持的启动顺序，当前启动顺序只支持hd和cdrom两种"),
    V40029(40029, "不支持的磁盘驱动类型，当前仅支持virtio、scsi、sata、ide类型"),
    V40030(40030, "image_id 对应的镜像不存在"),
    V40031(40031, "设备Id不存在"),
    V40032(40032, "设备加入安全组，不能删除"),
    V40033(40033, "单臂模式只能有一个接口"),
    V40034(40034, "双臂模式只能有两个接口"),
    V40035(40035, "tab = ${s} 暂不支持，当前仅支持vm或sslo"),

    // 备份策略状态码
    V42000(42000, "vm_id 虚机id不能为空!"),
    V42001(42001, "vm_id 虚机不存在!"),
    V42002(42002, "policy_name 策略名称不能为空!"),
    V42003(42003, "policy_name = ${s} 策略名称已存在!"),
    V42004(42004, "time = ${s} 策略备份时间不合法!"),
    V42005(42005, "week = ${s} 策略备份周期重复或不合法!"),
    V42006(42006, "week = ${s} 策略备份周期不可重复!"),
    V42007(42007, "time = ${s} week = ${s2} 策略备份周期已存在!"),
    V42008(42008, "备份保留数值不在有效范围 1-${s} 内!"),
    V42009(42009, "单个虚机备份策略个数不能超过上限 ${s} 个!"),
    V42010(42010, "全局备份策略个数不能超过上限 ${s} 个!"),
    V42011(42011, "policy_id 策略备份id不能为空!"),
    V42012(42012, "policy_id 备份策略不存在!"),
    V42013(42013, "该虚机不是共享存储，无法执行网元手动备份!"),
    V42014(42014, "backup_id 网元备份id不存在!"),
    V42015(42015, "backup_id 网元备份id不能为空!"),

    // 备份、回滚、迁移状态码
    V42100(42100, "全局备份文件个数不能超过上限 ${s} 个!"),
    V42101(42101, "${s} 虚机不是共享存储，当前仅支持共享存储虚机!"),
    V42102(42102, "${s} 虚机正在部署中，请稍后重试!"),
    V42103(42103, "${s} 虚机部署状态异常，请稍后重试!"),
    V42104(42104, "${s} 虚机正在手动迁移中，请稍后重试!"),
    V42105(42105, "${s} 虚机正在回滚中，请稍后重试!"),
    V42106(42106, "${s} 虚机正在备份中，请稍后重试!"),
    V42107(42107, "${s} 虚机正在克隆中，请稍后重试!"),
    V42108(42108, "vm_name = ${s} 虚机已存在！"),
    V42109(42109, "host_id 物理主机id不能为空!"),
    V42110(42110, "物理主机无变化，请选择其他物理主机进行作为迁移目标物理主机!"),
    V42111(42111, "host_id 物理主机id不存在!"),
    V42112(42112, "当前备份文件正在备份中, 请稍后重试!"),
    V42113(42113, "当前备份文件正在删除中，请稍后重试!!"),
    V42114(42114, "当前备份文件正在备份中，请稍后重试!"),
    V42115(42115, "当前备份文件正在进行虚机回滚中，请稍后重试!"),
    V42116(42116, "当前备份文件正在进行虚机克隆中，请稍后重试!"),
    V42117(42117, "当前网元备份文件备份失败, 无法执行此操作!"),
    V42118(42118, "${s} 虚机正在自动故障漂移中，请稍后重试!"),
    V42119(42119, "虚机手动迁移功能未启用，请联系服务商开启此功能!"),
    V42120(42120, "vm_name 虚机名称不能为空!"),
    V42121(42121, "当前备份文件正在转镜像中，请稍后重试!!"),
    V42122(42122, "${s} 虚机正在运行中，请先执行软关机，待软关机成功且虚机为关机状态后，再重试!"),
    V42123(42123, "${s} 虚机引导ISO镜像启动方式是CD-ROM启动，CD-ROM启动不支持迁移，如果需要继续迁移，还请先修改引导，然后再重试!"),

    // 资源验证状态码
    V43000(43000, "${s} 虚机存在直通网卡，不支持此操作！"),
    V43001(43001, "${s1} 物理主机和 ${s2} 物理主机架构类型不同！"),
    V43002(43002, "${s} 物理主机未开启CPU绑定！"),
    V43003(43003, "${s} 物理主机可用的绑定CPU不足！"),
    V43004(43004, "vsw可用CPU不足！"),
    V43005(43005, "${s} 物理主机没有相同的网络！"),
    V43006(43006, "${s} 网络配置异常！"),
    V43007(43007, "${s} 物理主机未开启资源阈值配置！"),
    V43008(43008, "${s} 物理主机CPU资源不足！"),
    V43009(43009, "${s} 物理主机大页内存资源不足！"),
    V43010(43010, "${s} 物理主机内存资源不足！"),
    V43011(43011, "DHCP IP地址不足!"),
    V43012(43012, "${s} 虚机存在直通网卡，不支持手动迁移操作！"),
    V43013(43013, "${s} 物理主机磁盘不足！"),

    UNKNOWN_NETWORK_TYPE(40026, "未知的网络类型 ${s}"),
    NETWORK_ID_NOT_BLANK(40027, "networkId 不能为空"),
    NETWORK_TYPE_NOT_BLANK(40028, "networkType 不能为空"),
    INTERFACE_LIST_NOT_EMPTY(40029, "interfaceList 不能为空"),

    INTERFACE_ID(40030, "interfaceId 不能为空"),
    //虚机组管理
    VG50001(50001, "vm_group_name不能为空"),
    VG50002(50002, "vm_group_name名称重复"),
    VG50003(50003, "vendor_name不能为空"),
    VG50004(50004, "vm_type不能为空"),
    VG50005(50005, "vm_type不在支持的范围内"),
    VG50006(50006, "defend_type不能为空"),
    VG50007(50007, "defend_type必须为1或2"),
    VG50008(50008, "vm_id_list不能为空"),
    VG50009(50009, "vm_id_list中${s}不存在"),
    VG50010(50010, "vm_id_list中${s}的vm_vendor和虚机组的vendor_name不一致"),
    VG50011(50011, "vm_id_list中${s}的vm_type和虚机组的vm_type不一致"),
    VG50012(50012, "vm_id_list中${s}的vm_defend_type和虚机组的defend_type不一致"),
    VG50013(50013, "vm_id_list中${s}已经在其他虚拟机组中，请重新添加！"),
    VG50014(50014, "虚机组已被客户关联，无法移除。还请先删除客户的绑定的虚机组，然后再操作"),
    VG500141(500141, "虚机组已下发服务链，无法移除。还请先删除添加的服务链，然后再操作"),
    VG50015(50015, "虚机组内还有虚机，还请先将虚机从组内摘除，然后再操作"),
    VG50016(50016, "vm_group_name中不能包含#"),
    VG50017(50017, "vm_id_list中${s}未配置IP，请先配置IP后再加入虚机组！"),
    VG50018(50018, "虚机组已经下发服务链，至少保留一个虚机"),

    //虚拟交换机管理
    VSW60001(60001, "vrouter_id不能为空"),
    VSW60002(60002, "vrouter_id不存在"),

    //客户管理
    C70001(70001, "customer_id重复"),
    C70002(70002, "networks不能为空"),
    C70003(70003, "network_id不能为空"),
    C70004(70004, "type不能为空"),
    C70005(70005, "type必须为ip 或 rang 或 subnet"),
    C70006(70006, "value不能为空"),
    C70007(70007, "value格式错误"),
    C70008(70008, "ip+port和已有的有重复"),
    C70009(70009, "ip_type必须为ipv4 或 ipv6"),
    C70010(70010, "客户关联的有虚机组，还请先删除和虚机组的关联，然后再试"),
    C70011(70011, "vm_group_id_list不能为空"),
    C70012(70012, "vm_group_id_list中有vm_group_id不存在"),
    C70013(70013, "vm_group_id_list中vm_group_id有重复"),
    C70014(70014, "vm_group_id_list中有虚机组已被该客户关联"),
    C70015(70015, "vm_group_id_list中有虚机组内无虚机，还请添加资产"),
    C70016(70016, "vm_group_id_list中虚机组已在服务链中，还请先把对应虚机组从服务链中删除，然后再试"),
    C70017(70017, "network_id重复"),
    C70018(70018, "network_id不存在"),
    C70019(70019, "network_ids中有网络已有服务链，不可修改或删除"),
    C70020(70020, "network_ids中有network_id不存在"),
    C70021(70021, "band_width不能为空"),
    C70022(70022, "customer_id中不能包含#"),
    C70023(70023, "客户下至少存在一个network，不能全部删除"),
    C70024(70024, "network_id已有服务链，不可修改或删除"),
    C70025(70025, "network.value的类型与network.ip_type值不匹配"),
    C70026(70026, "ip不能为空"),

    //服务链管理
    S80001(80001, "service_chain_id重复"),
    S80002(80002, "customer_network_ids中有customer_network_id不存在"),
    S80003(80003, "customer_network_ids中有customer_network_id已存在同类型的服务链"),
    S80004(80004, "type不能为空"),
    S80005(80005, "type必须为1或2"),
    S80006(80006, "vm_group_id_list不能为空"),
    S800061(800061, "串行节点(serial_list)和旁路节点(monitor_list)不能同时为空"),
    S80007(80007, "vm_group_id_list中有vm_group_id不存在"),
    S80008(80008, "vm_group_id_list中有vm_group_id未关联该客户"),
    S80009(80009, "vm_group_id_list中vm_group_id有重复"),
    S80010(80010, "vm_group_id_list中虚机组个数超出引流单条节点数数量上限"),
    S80011(80011, "vm_group_id_list中虚机组不能同时存在于多种服务链模式中"),
    S80012(80012, "service_chain_id不能为空"),
    S80013(80013, "service_chain_id不存在"),
    S80014(80014, "vm_group_id_list中虚机组的vm_type=${s}类型相同"),
    S80015(80015, "vm_group_id_list中有虚机组内无虚机，还请添加"),
    S80016(80016, "vrf_id不在0~4095范围内"),
    S80017(80017, "该客户下无对应network，无法进行服务链编排"),
    S80018(80018, "服务链中存在非流量型网元组(${s})，非流量型网元组不可进行服务链编排，请重试"),
    S80019(80019, "vm_group_id_list与customer_network_ids不能同时为空"),
    S80020(80020, "network_ids中有network_id已存在同类型的服务链"),
    S80021(80021, "network_ids不能为空"),
    S80022(80022, "vm_group_id_list中的${s}引流id(loId)不能为空"),
    S80023(80023, "network_ids中有network_id不存在"),
    S80024(80024, "network_ids中有network_id被其他服务链占用"),
    S80025(80025, "network_id不存在服务链"),


    //地址映射管理
    NST90001(90001,
            "对应protocol_type:private_network_ip:private_network_port = ${s}已配置过内外网映射"),
    NST90002(90002,
            "对应protocol_type:public_network_ip:public_network_port = ${s}已配置过内外网映射"),
    NST90003(90003, "private_network_ip不能为空"),
    NST90004(90004, "private_network_port不能为空"),
    NST90005(90005, "public_network_ip不能为空"),
    NST90006(90006, "public_network_port不能为空"),
    NST90007(90007, "protocol_type不能为空"),
    NST90008(90008, "private_network_ip = ${s} 格式不正确"),
    NST90009(90009, "public_network_ip = ${s} 格式不正确"),
    NST90010(90010, "private_network_port = ${s} 不在0~65535范围内"),
    NST90011(90011, "public_network_port = ${s} 不在0~65535范围内"),
    NST90012(90012, "protocol_type不在支持范围内，支持的范围为：tcp，udp, icmp"),
    NST90013(90013, "natstatic_id不能为空"),
    NST90014(90014, "natstatic_id = ${s}不存在"),
    NST90015(90015, "public_network_ip = ${s}不在地址池内，还请先配置对应的地址池，然后再创建静态Nat"),
    NST90016(90016, "vm_group_id = ${s} 安全组不存在!"),
    NST90017(90017, "云网关类型的安全组不存在!"),
    NST90018(90018, "请先到地址池页面创建地址池!"),
    NST90019(90019, "vm_group_id 不能为空!"),
    NST90020(90020, "private_network_ip和public_network_ip地址类型需要保持一致!"),
    NST90021(90021, "private_network_ip和public_network_ip子网掩码需要保持一致!"),
    NST90022(90022, "多对多静态nat仅支持all协议类型!"),

    ACL91003(91003, "name = ${s} 对应的接口不存在!"),
    ACL91004(91004, "rules 规则不能为空!"),
    ACL91005(91005, "rule_id = ${s} 范围不合法!"),
    ACL91006(91006, "rule_id = ${s} 规则id不能重复!"),
    ACL91007(91007, "rule_id = ${s} 规则已存在!"),
    ACL91008(91008, "src_ip = ${s} 格式不正确! 地址格式必须是CIDR地址或者ANY!"),
    ACL91009(91009, "src_port = ${s} 源端口不合法!"),
    ACL91010(91010, "dst_ip = ${s} 格式不正确! 地址格式必须是CIDR地址或者ANY!"),
    ACL91011(91011, "dst_port = ${s} 目的端口不合法!"),
    ACL91012(91012, "protocol = ${s} 不合法!"),
    ACL91013(91013, "protocol = ${s} 对应的src_port和dst_port端口都必须为空!"),
    ACL91014(91014, "protocol = ${s} 对应的src_port和dst_port端口都不能为空!"),
    ACL91015(91015, "action = ${s} 不合法!"),
    ACL91016(91016, "acl_id 不能为空!"),
    ACL91017(91017, "acl_id = ${s} 不存在!"),
    ACL91018(91018, "rule_ids 规则不能为空!"),
    ACL91019(91019, "rule_id = ${s} 规则不存在!"),
    ACL91020(91020, "interface_names 接口集合不能为空!"),
    ACL91021(91021, "rule_id 不能为空!"),

    // 路由错误码
    ROU91030(91030, "ip_type = ${s}! 不合法!，支持的类型IPV4、IPV6"),
    ROU91031(91031, "router_id 不能为空!"),
    ROU91032(91032, "router_id 不存在!"),
    ROU91033(91033, "target_ip = ${s} 目标IP格式不合法!"),
    ROU91034(91034, "netmask = ${s} 子网掩码格式不合法!"),
    ROU91035(91035, "gateway = ${s} 网关格式不合法!"),
    ROU91036(91036, "gateway 和 interface_name 必须二选一!"),

    INT92001(92001, "name = ${s} 主接口不存在!"),
    INT92002(92002, "name = ${s} 子接口不存在!"),
    INT92003(92003, "name 接口名称不能为空!"),
    INT92004(92004, "vlan_id = ${s} 不在合法范围内!"),
    INT92005(92005, "name = ${s} 子接口已存在!"),
    INT92006(92006, "status = ${s} 状态不合法!"),
    INT92007(92007, "ipv4 = ${s} 地址不合法!"),
    INT92008(92008, "ipv4_netmask = ${s} 子网掩码不合法!"),
    INT90050(90050, "vm_id 云网关网元id不能为空!"),
    INT90051(90051, "vm_id = ${s} 云网关网元实例不存在!"),

    // VPN隧道状态码
    VPN93001(93001, "ipsec_name = ${s} 隧道名称不合法!仅支持数字、英文，长度必须在1-20个字符之间!"),
    VPN93002(93002, "local_public_ip = ${s} 本端公网IP格式不合法!"),
    VPN93003(93003, "remote_public_ip = ${s} 对端公网IP格式不合法!"),
    VPN93004(93004, "local_subnet = ${s} 能力池主机私网IP段格式不合法!"),
    VPN93005(93005, "remote_subnet = ${s} 客户主机私网IP格式不合法!"),
    VPN93006(93006, "pre_shared_key = ${s} 不合法! 当前仅支持pre-shared-key枚举值! "),
    VPN93007(93007, "ike_version = ${s} 不合法! 当前仅支持1或2枚举值!"),
    VPN93008(93008, "ike_mode = ${s} 不合法! 当前仅支持main或aggressive枚举值!"),
    VPN93009(93009, "local_id = ${s1} 不合法! 原因 = ${s2}"),
    VPN93010(93010, "remote_id = ${s1} 不合法! 原因 = ${s2} "),
    VPN93011(93011, "secret_key = ${s} 不合法! 当pre-shared-key为预共享密钥时，密钥不能为空! "),
    VPN93012(93012, "sa_initiate = ${s} 不合法! sa_initiate必须和ipsec_name值相同! "),
    VPN93013(93013, "vpn_id 不能为空!"),
    VPN93014(93014, "vpn_id 不存在!"),
    VPN93015(93015, "ipsec_name = ${s} 已存在!"),
    VPN93016(93016, "ident_ip = ${s} 不合法!"),
    VPN93017(93017, "target_ip = ${s} 不合法!"),
    VPN93018(93018, "ident_ip = ${s} 不可达!"),
    VPN93019(93019, "secret_key 密钥解密失败!"),

    SRV6190001(190001, "vm_id 不能为空!"),
    SRV6190002(190002, "vm_id = ${s} 不存在!"),

    //SC 服务链
    //add
    SC16000(16000, "服务链组(vm_group_id_list)不能为空"),
    SC16001(16001, "服务链类型(type)不能为空"),
    SC16003(16003, "用户不存在"),
    SC16004(16004, "服务链ID已存在"),
    SC16005(16005, "虚机组超出引流单条节点数数量上限"),
    SC16006(16006, "查询Relation关系表接口错误"),
    SC16007(16007, "网络id异常，请填写正确的网络id"),
    SC16008(16008, "资产已被其他服务链使用"),
    SC16009(16009, "获取服务组信息失败"),
    SC16010(16010, "虚机组信息不存在"),
    SC16011(16011, "服务组为空"),
    SC16012(16012, "服务链上的节点类型不能重复"),
    SC16013(16013, "虚拟组的defend_type和服务链的type不一致"),
    SC16014(16014, "引流部署模式设置异常"),
    SC16015(16015, "服务链已存在"),
    SC16016(16016, "服务链添加失败"),
    SC16017(16017, "虚机组不能同时存在于多种部署模式中"),

    //update
    SC16018(16018, "service_china_id不能为空"),
    SC16019(16019, "未添加服务链"),
    SC16020(16020, "服务链不存在"),
    SC16021(16021, "操作的节点为空"),
    SC16022(16022, "服务链修改失败"),

    //delete

    //CUS 客户
    //add
    CSU11000(11000, "该客户id重复添加! 请重新输入!"),
    CSU11001(11001, "客户资产Network_id重复!"),
    CSU11002(11002, "客户资产Network_id已存在!"),
    CSU11003(11003, "资产ip网段重复!"),
    CSU11004(11004, "添加客户-新增专线信息失败!"),
    CSU11005(11005, "添加客户-新增专线用户信息失败!"),
    CSU11006(11006, "添加客户-创建安全域失败!"),

    //list
    CSU11007(11007, "获取客户对应安全域和安全服务能力信息为空！请检查客户id是否正确!"),
    CSU11008(11008, "组装客户对应安全能力数据错误!"),
    CSU11009(11009, "获取客户对应安全域和安全服务能力-列表错误!"),

    //delete
    CSU11010(11010, "删除客户错误!"),
    CSU11011(11011, "用户已绑定设备，请解除绑定后再删除!"),
    CSU11012(11012, "customer_id不存在，请填写正确的客户id!"),

    //bond
    CSU11013(11013, "vm_group_id_list 重复!"),
    CSU11014(11014, "该用户未添加，请添加用户后再试!"),
    CSU11015(11015, "虚机组ID不存在，请检查虚机组ID集合!"),
    CSU11016(11016, "虚机组内还未添加虚机，请先为虚机组新增虚机!"),
    CSU11017(11017, "虚机组内的devIds有重复id!"),
    CSU11018(11018, "根据devIds未找到相关设备!"),
    CSU11019(11019, "虚机组内的虚机信息有误!请检查!"),
    CSU11020(11020, "用户已绑定过该设备，请勿重复绑定!"),
    CSU11021(11021, "绑定设备出错!已回滚数据!"),
    CSU11022(11022, "绑定设备出错!回滚vm设备数据错误!"),
    CSU11023(11023, "绑定设备出错!回滚配属数据错误!"),

    //unbond
    CSU11024(11024, "groupIds有重复!"),
    CSU11025(11025, "设备已下发服务链，请删除服务链后再取消设备关联!"),
    CSU11026(11026, "虚机组Id不存在!"),
    CSU11027(11027, "设备信息为空!"),

    //customerInVmGroup

    //addNetwork

    //updateNetwork
    CSU11028(11028, "网络下存在服务链！请先删除服务链!"),
    CSU11029(11029, "未查询到此网络信息!"),

    //deleteNetwork
    CSU11030(11030, "网络资产id错误，请检查该客户的网络资产id信息!"),
    CSU11031(11031, "查找对应的服务链关系错误!"),
    CSU11032(11032, "网络下存在服务链!请先删除服务链!"),

    //host 主机
    HO12000(12000, "资源池下无该主机信息!"),
    HO12001(12001, "主机id为空!"),

    NO_SUPPORT_CEPH(12002, "主机%s不支持ceph存储!"),
    NO_SUPPORT_THOUGH(12003, "自动故障漂移的虚机不支持带直通网卡!"),
    CEPH_SERVICE_ERROR(12004, "主机ceph服务异常!"),

    //putTemplate
    TE17001(17001, "未查询到该模板的镜像信息!"),
    TE17002(17002, "查询该模板的镜像信息错误!"),

    //vm 网元
    VM18000(18000, "管理IP格式错误!"),
    VM18001(18001, "管理IP重复!"),
    VM18002(18002, "请填写防护类型 vm_defend_type!"),

    //vmGroup
    VM19000(19000, "参数错误!"),
    VM19001(19001, "虚机组名称重复!"),
    VM19002(19002, "vm_id_list值不能为空!"),
    VM19003(19003, "vm_group_id值不能为空!"),
    VM19004(19004, "json配置错误!"),

    NULL(5001, "请求参数为空"),
    NULLPOOL(5011, "未找到对应的资源池"),
    NULL_SRV6_CONFIG(5012, "没有此VR配置"),

    //imageV2
    IMAGE_V2_100001(100001, "image_name不能为空"),
    IMAGE_V2_100002(100002, "image_name = ${s}已存在"),
    IMAGE_V2_100003(100003, "image_file_name不能为空"),
    IMAGE_V2_100004(100004, "image_file_size不能为空"),
    IMAGE_V2_100005(100005, "type不能为空"),
    IMAGE_V2_100006(100006, "type不在可支持的范围内"),
    IMAGE_V2_100007(100007, "cpu_architecture不能为空"),
    IMAGE_V2_100008(100008, "cpu_architecture不在x86和ARM的范围内"),
    IMAGE_V2_100009(100009, "image_type不能为空"),
    IMAGE_V2_100010(100010, "image_type不在1和2的范围内"),
    IMAGE_V2_100011(100011, "version不能为空"),
    IMAGE_V2_100012(100012, "image_id不能为空"),
    IMAGE_V2_100013(100013, "image_id不存在"),
    IMAGE_V2_100014(100014, "镜像文件名称格式不对, 请按照：产品类型_网元类型_网元组类型_Version_架构_xxxx.qcow2/iso格式进行命名，比如：FW_1_3_version_x86_xxxx.qcow2/iso"),
    IMAGE_V2_100015(100015, "镜像文件名称格式不对，其中‘${s}’有误，请按照：产品类型_网元类型_网元组类型_Version_架构_xxxx.qcow2/iso格式进行命名，比如：FW_1_3_version_x86_xxxx.qcow2/iso"),
    IMAGE_V2_100016(100016, "镜像文件名称不能为空"),
    IMAGE_V2_100017(100017, "镜像文件名不能包含中文"),
    IMAGE_V2_100018(100018, "镜像文件名只能包含字母、数字、下划线、小数点、中划线"),
    IMAGE_V2_100019(100019, "镜像文件上传失败"),
    IMAGE_V2_100020(100020, "image_file_name = ${s}已存在"),
    IMAGE_V2_100021(100021, "该镜像或设备型号被虚机设备使用中，无法删除!"),

    STORAGE_110000(110000, "通过id未找到对应存储"),
    STORAGE_110001(110001, "主机${s}目录下有文件"),
    STORAGE_110002(110002, "${s}存储正在执行任务中"),
    STORAGE_110003(110003, "${s}存储正在被虚机或镜像使用"),
    STORAGE_110004(110004, "所选主机不是主节点，还请选择主节点"),


    ;
    /**
     * 编码
     */
    private final Integer code;


    /**
     * 消息
     */
    private final String message;


    ApiResultCode(Integer code, String message) {
        this.code = code;
        this.message = message;
    }


    public Integer code() {
        return this.code;
    }


    public String message() {
        return this.message;
    }


    public static Integer getCode(String name) {
        for (ApiResultCode apiResultCode : ApiResultCode.values()) {
            if (apiResultCode.name().equals(name)) {
                return apiResultCode.code;
            }
        }
        return null;
    }

    public String getMessage(Class cla) {
        return message.replace("${s}", cla.getName());
    }

    public String getMessage(String name) {
        return message.replace("${s}", name == null ? "null" : name);
    }

    public String getMessage(String param1, String param2) {
        return message.replace("${s1}", param1 == null ? "null" : param1).replace("${s2}", param2 == null ? "null" : param2);
    }

    public static ApiResultCode getEnumByCode(Integer code) {

        for (ApiResultCode apiResultCode : ApiResultCode.values()) {
            if (apiResultCode.code().equals(code)) {
                return apiResultCode;
            }
        }
        return INTERNAL_SERVER_ERROR;
    }

    public static ApiResultCode getEnumByCode(String codeStr) {
        if (!PubMethod.isEmpty(codeStr)) {
            Integer code = Integer.valueOf(codeStr);

            for (ApiResultCode apiResultCode : ApiResultCode.values()) {
                if (apiResultCode.code().equals(code)) {
                    return apiResultCode;
                }
            }
        }
        return INTERNAL_SERVER_ERROR;
    }


    @Override
    public String toString() {
        return this.name();
    }


    /**
     * 测试编码重复
     *
     * @param args
     */
    public static void main(String[] args) {
        /*ApiResultCode[] apiResultCodes = ApiResultCode.values();
        List<Integer> list = new ArrayList<Integer>();
        for (ApiResultCode apiResultCode : apiResultCodes) {
            if (list.contains(apiResultCode.code)) {
                System.out.println("编码重复：" + apiResultCode.code);
            } else {
                list.add(apiResultCode.code());
            }
        }*/
        System.out.println(ApiResultCode.getEnumByCode("16000"));

    }
}
