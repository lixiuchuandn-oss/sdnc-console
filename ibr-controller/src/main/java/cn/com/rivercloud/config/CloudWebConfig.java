package cn.com.rivercloud.config;

import cn.com.rivercloud.config.interceptor.Interceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import javax.annotation.Resource;
import java.util.ArrayList;

/**
 * @author 温高峰
 */
@Configuration
public class CloudWebConfig implements WebMvcConfigurer {

    @Resource
    private Interceptor interceptor;


    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        ArrayList<String> list = new ArrayList<>();
        list.add("/**/ctcontrol/**");
        list.add("/**/vrcontrol/**");
        registry.addInterceptor(interceptor).addPathPatterns(list);
    }
}