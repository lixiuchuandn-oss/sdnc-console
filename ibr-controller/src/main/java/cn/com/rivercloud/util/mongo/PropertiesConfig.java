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
                        instance.properties = loadProperties();
                    } catch (IOException e) {
                        e.printStackTrace();
                    }
                }
            }
        }
        return instance;
    }

    /**
     * 先读 application.properties，再按当前 Spring profile 覆盖。
     * DbManager 不走 Spring Environment，docker 部署必须在这里吃到 application-docker.properties，
     * 否则 mongodb.host 会停在 127.0.0.1，容器内连不上 Compose 里的 Mongo。
     */
    private static Properties loadProperties() throws IOException {
        Properties properties = PropertiesLoaderUtils.loadProperties(new ClassPathResource(QUARTZ_PROPERTIES));
        String profiles = activeProfiles(properties);
        if (profiles == null) {
            return properties;
        }
        for (String raw : profiles.split(",")) {
            String profile = raw.trim();
            if (!profile.matches("[A-Za-z0-9_-]+")) {
                continue;
            }
            ClassPathResource overlay = new ClassPathResource("/application-" + profile + ".properties");
            if (!overlay.exists()) {
                continue;
            }
            properties.putAll(PropertiesLoaderUtils.loadProperties(overlay));
        }
        return properties;
    }

    private static String activeProfiles(Properties base) {
        String fromProp = System.getProperty("spring.profiles.active");
        if (fromProp != null && !fromProp.trim().isEmpty()) {
            return fromProp.trim();
        }
        String fromEnv = System.getenv("SPRING_PROFILES_ACTIVE");
        if (fromEnv != null && !fromEnv.trim().isEmpty()) {
            return fromEnv.trim();
        }
        String fromFile = base.getProperty("spring.profiles.active");
        if (fromFile != null && !fromFile.trim().isEmpty()) {
            return fromFile.trim();
        }
        return null;
    }

    public Properties getProperties(){
        return PropertiesConfig.getInstacne().properties;
    }
}
