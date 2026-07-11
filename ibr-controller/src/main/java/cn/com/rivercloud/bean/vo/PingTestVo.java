package cn.com.rivercloud.bean.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * @author LiYutao
 * @date 2024/5/28
 * @description
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PingTestVo {

    private String ident_ip;

    private String target_ip;
}
