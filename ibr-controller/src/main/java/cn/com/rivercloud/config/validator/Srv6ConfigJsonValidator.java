package cn.com.rivercloud.config.validator;

import cn.com.rivercloud.util.exception.ServiceException;
import cn.com.rivercloud.util.result.ApiResultCode;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.networknt.schema.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeansException;
import org.springframework.beans.factory.BeanFactory;
import org.springframework.beans.factory.BeanFactoryAware;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.nio.file.*;
import java.util.Set;

@Slf4j
@Configuration
public class Srv6ConfigJsonValidator implements InitializingBean, BeanFactoryAware {

    private DefaultListableBeanFactory beanFactory;

    @Value("${srv6.config.path:/usr/local/src/csm-controller/resources/Srv6ConfigSchema.json}")
    private String schemaPath;

    @Bean
    public JsonSchema internetRoutingSchema() throws IOException {
        return JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012)
                .getSchema(new ClassPathResource("Srv6ConfigSchema.json").getInputStream(),
                        SchemaValidatorsConfig.builder().errorMessageKeyword("errorMessage").build());
    }

    @Override
    public void afterPropertiesSet() throws Exception {
        Path configFilePath = Paths.get(schemaPath);
        WatchService watchService = FileSystems.getDefault().newWatchService();
        Path configDir = configFilePath.getParent();
        configDir.register(watchService, StandardWatchEventKinds.ENTRY_MODIFY, StandardWatchEventKinds.OVERFLOW);
        // 在一个单独的线程中运行监控
        new Thread(() -> {
            try {
                watchForChanges(watchService, configFilePath);
            } catch (Exception e) {
                log.error("watchForChanges error==> {}", e.getMessage(), e);
            }
        }).start();
    }

    @Override
    public void setBeanFactory(BeanFactory beanFactory) throws BeansException {
        this.beanFactory = (DefaultListableBeanFactory) beanFactory;
    }

    /**
     * 校验json
     * @param json
     * @return
     */
    public void validate(String json) {
        try {
            JsonNode jsonNode = new ObjectMapper().readTree(json);
            Set<ValidationMessage> validDataErrors = internetRoutingSchema().validate(jsonNode);
            if (!validDataErrors.isEmpty()) {
                StringBuilder logPrefix = new StringBuilder();
                validDataErrors.forEach(error -> logPrefix.append(error.getMessage()).append("\n"));
                throw new ServiceException(
                        String.valueOf(ApiResultCode.VM19004.code()), logPrefix.toString());
            }
        } catch (IOException e) {
            log.error("validate error==> {}", e.getMessage());
        }
    }

    private void watchForChanges(WatchService watchService, Path configFilePath)
            throws InterruptedException, IOException {
        while (true) {
            WatchKey key = watchService.take();
            for (WatchEvent<?> event : key.pollEvents()) {
                WatchEvent.Kind<?> kind = event.kind();
                if (kind == StandardWatchEventKinds.OVERFLOW) {
                    continue;
                }
                @SuppressWarnings("unchecked")
                WatchEvent<Path> ev = (WatchEvent<Path>) event;
                Path fileName = ev.context();
                if (fileName.equals(configFilePath.getFileName())) {
                    // 文件发生了变化，将之前的jsonSchema对象销毁，重新创建
                    log.info("Config file updated: {}", configFilePath);
                    beanFactory.destroySingleton("internetRoutingSchema");
                    beanFactory.registerSingleton("internetRoutingSchema",
                            JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012).getSchema(
                                    Files.newInputStream(configFilePath.toFile().toPath()),
                                    SchemaValidatorsConfig.builder()
                                            .errorMessageKeyword("errorMessage")
                                            .build()));
                }
            }
            boolean valid = key.reset();
            if (!valid) {
                break;
            }
        }
    }
}
