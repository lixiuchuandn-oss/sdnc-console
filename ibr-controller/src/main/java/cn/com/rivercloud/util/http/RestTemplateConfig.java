package cn.com.rivercloud.util.http;

import org.apache.commons.lang3.StringUtils;
import org.apache.commons.lang3.math.NumberUtils;
import org.apache.http.HttpResponse;
import org.apache.http.client.HttpClient;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.config.Registry;
import org.apache.http.config.RegistryBuilder;
import org.apache.http.conn.ConnectionKeepAliveStrategy;
import org.apache.http.conn.socket.ConnectionSocketFactory;
import org.apache.http.conn.socket.PlainConnectionSocketFactory;
import org.apache.http.conn.ssl.NoopHostnameVerifier;
import org.apache.http.conn.ssl.SSLConnectionSocketFactory;
import org.apache.http.conn.ssl.TrustStrategy;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;
import org.apache.http.impl.conn.PoolingHttpClientConnectionManager;
import org.apache.http.protocol.HTTP;
import org.apache.http.protocol.HttpContext;
import org.apache.http.ssl.SSLContextBuilder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.HttpComponentsClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.SSLContext;
import java.security.KeyManagementException;
import java.security.KeyStoreException;
import java.security.NoSuchAlgorithmException;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.time.Duration;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;

/**
 * 描述：
 *
 * @Author:
 */
@Configuration
public class RestTemplateConfig {

    @Value("${restTemplate.max.total:200}")
    Integer maxTotal;
    @Value("${restTemplate.maxPerRoute:20}")
    Integer maxPerRoute;

    @Value("${connect.time.out:30000}")
    Integer connectTimeout;

    @Value("${read.time.out:600000}")
    Integer readTimeout;

    @Value("${connection.request.time.out:10000}")
    Integer connectionRequestTimeout;

    private final long DEFAULT_SECOND=30;
    @Bean
    public RestTemplate restTemplate(RestTemplateBuilder builder) {
        return builder
                .setConnectTimeout(Duration.ofMillis(connectTimeout))
                .setReadTimeout(Duration.ofMillis(readTimeout))
                .requestFactory(this::httpRequestFactory)
                .build();

    }

    public ClientHttpRequestFactory httpRequestFactory() {
        try {
            return new HttpComponentsClientHttpRequestFactory(httpClient());
        } catch (NoSuchAlgorithmException e) {
            e.printStackTrace();
        } catch (KeyManagementException e) {
            e.printStackTrace();
        } catch (KeyStoreException e) {
            e.printStackTrace();
        }
        return new HttpComponentsClientHttpRequestFactory();
    }


    public HttpClient httpClient() throws NoSuchAlgorithmException, KeyManagementException, KeyStoreException {
        HttpClientBuilder b = HttpClientBuilder.create();

        // 设置信任所有证书
        SSLContext sslContext = new SSLContextBuilder().loadTrustMaterial(null, new TrustStrategy() {
            @Override
            public boolean isTrusted(X509Certificate[] arg0, String arg1) throws CertificateException {
                return true;
            }
        }).build();
        b.setSSLContext(sslContext);

        HostnameVerifier hostnameVerifier = NoopHostnameVerifier.INSTANCE;

        SSLConnectionSocketFactory sslSocketFactory = new SSLConnectionSocketFactory(sslContext, hostnameVerifier);
        Registry<ConnectionSocketFactory> registry = RegistryBuilder.<ConnectionSocketFactory>create()
                .register("http", PlainConnectionSocketFactory.getSocketFactory())
                .register("https", sslSocketFactory).build();

        PoolingHttpClientConnectionManager connectionManager = new PoolingHttpClientConnectionManager(registry);
        // 设置最大连接池的数量
        connectionManager.setMaxTotal(maxTotal);
        // 每个主机的最大并发量，route是指域名。--对MaxTotal的细化
        connectionManager.setDefaultMaxPerRoute(maxPerRoute);

        RequestConfig requestConfig = RequestConfig.custom()
                // 数据返回超时时间
                .setSocketTimeout(readTimeout)
                // 连接超时时间
                .setConnectTimeout(connectTimeout)
                // 从连接池中获取连接的超时时间
                .setConnectionRequestTimeout(connectionRequestTimeout)
                .build();

        CloseableHttpClient closeableHttpClient = HttpClientBuilder.create()
                .setDefaultRequestConfig(requestConfig)
                .setConnectionManager(connectionManager)
                .evictIdleConnections(30, TimeUnit.SECONDS)
                .setKeepAliveStrategy(new ConnectionKeepAliveStrategy() {
                    @Override
                    public long getKeepAliveDuration(HttpResponse response, HttpContext context) {
                        return Arrays.asList(response.getHeaders(HTTP.CONN_KEEP_ALIVE))
                                .stream()
                                .filter(h-> StringUtils.equalsAnyIgnoreCase(h.getName(),"timeout")
                                        && StringUtils.isNumeric(h.getValue()))
                                .findFirst()
                                .map(h-> NumberUtils.toLong(h.getValue(),DEFAULT_SECOND))
                                .orElse(DEFAULT_SECOND)*1000;
                    }
                })
                .build();

        return closeableHttpClient;
    }
}