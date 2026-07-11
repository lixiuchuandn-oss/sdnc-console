package cn.com.rivercloud.util.mongo;

import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.support.PropertiesLoaderUtils;

import java.io.IOException;
import java.util.Properties;

/**
 * @Author : chenhao
 * @Date : 2019/12/20 0020 16:52
 */
public class PropertiesConfig {

    private static volatile PropertiesConfig instance;

    private Properties properties = null;

    private static final String QUARTZ_PROPERTIES = "/application.properties";

    private PropertiesConfig() {

    }

    public static PropertiesConfig getInstacne(){
        if (null == instance) {
            synchronized (PropertiesConfig.class) {
                if (null == instance) {
                    instance = new PropertiesConfig();
                    try {
                        ClassPathResource classPathResource = new ClassPathResource(QUARTZ_PROPERTIES);
                        instance.properties = PropertiesLoaderUtils.loadProperties(classPathResource);
                    } catch (IOException e) {
                        e.printStackTrace();
                    }
                }
            }
        }
        return instance;
    }

    public Properties getProperties(){
        return PropertiesConfig.getInstacne().properties;
    }
}
