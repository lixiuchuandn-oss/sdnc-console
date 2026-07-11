package cn.com.rivercloud.util.http;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.ParameterizedType;

@Slf4j
@Component
public abstract class AbstractHttps<T> implements IHttps {

    @Autowired
    RestTemplate client;

    public abstract void addHeaders(HttpHeaders headers);

    public T get(HttpEntity<String> formEntity, String url) throws HttpClientErrorException {
        ResponseEntity<T> res = null;
        res =  client.exchange(url, HttpMethod.GET, formEntity, getClassOfT());
        isSuccess(res);
        return res.getBody();
    }

    public T post(HttpEntity<String> formEntity, String url) throws HttpClientErrorException{
        ResponseEntity<T> res = client.postForEntity(url, formEntity, getClassOfT());
        isSuccess(res);
        return res.getBody();
    }

    public T put(HttpEntity<String> formEntity, String url) throws HttpClientErrorException {
        ResponseEntity<T> res = null;
        res =  client.exchange(url, HttpMethod.PUT, formEntity, getClassOfT());
        isSuccess(res);
        return res.getBody();
    }

    public T delete(HttpEntity<String> formEntity, String url) throws HttpClientErrorException{
        ResponseEntity<T> res = client.exchange(url, HttpMethod.DELETE, formEntity, getClassOfT());
        isSuccess(res);
        return res.getBody();
    }

    public String url(String protocol, String ip ,int port) {
        return String.format("%s://%s:%s", protocol, ip, port);
    }

    private Class<T> getClassOfT() {
        return (Class<T>) ((ParameterizedType) this.getClass().getGenericSuperclass()).getActualTypeArguments()[0];
    }

    private void isSuccess(ResponseEntity t) throws HttpClientErrorException{
        if (!t.getStatusCode().is2xxSuccessful()) {
            throw new HttpClientErrorException(t.getStatusCode());
        }
    }

    public InputStream portForByte(HttpEntity<String> formEntity, String url) throws HttpClientErrorException{
        ResponseEntity<Resource> res = client.postForEntity(url, formEntity, Resource.class);
        isSuccess(res);
        try {
            return res.getBody().getInputStream();
        } catch (IOException e) {
            e.printStackTrace();
        }
        return null;
    }

}
