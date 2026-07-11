package cn.com.rivercloud.bean.vo;

import cn.com.rivercloud.enums.ReportConfigStatusEnum;
import lombok.Data;

import javax.validation.constraints.NotBlank;

@Data
public class ReportConfigStatusVo {

    /**
     * 唯一标识
     */
    @NotBlank(message = "uuid不能为空")
    private String uuid;

    /**
     * @see ReportConfigStatusEnum
     */
    private ReportConfigStatusEnum status;
}
