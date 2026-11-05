# 多阶段构建：Maven 打包 + JRE 运行（thin jar + lib/）
FROM maven:3.9-eclipse-temurin-8 AS build
WORKDIR /build
# 国内构建机常用：阿里云 Maven 中央库镜像（无外网直连 Maven Central 时必需）
RUN mkdir -p /root/.m2 && printf '%s\n' \
  '<settings>' \
  '  <mirrors>' \
  '    <mirror>' \
  '      <id>aliyun-central</id>' \
  '      <mirrorOf>*</mirrorOf>' \
  '      <url>https://maven.aliyun.com/repository/central</url>' \
  '    </mirror>' \
  '  </mirrors>' \
  '</settings>' > /root/.m2/settings.xml
COPY pom.xml assembly.xml ./
COPY src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:8-jre-jammy
WORKDIR /opt/csm-controller
COPY --from=build /build/target/csm-controller-0.0.1-SNAPSHOT.jar ./app.jar
COPY --from=build /build/target/lib ./lib
COPY --from=build /build/target/classes ./resources
RUN mkdir -p logs download \
  && mkdir -p /usr/local/src/csm-controller \
  && ln -sfn /opt/csm-controller/resources /usr/local/src/csm-controller/resources \
  && ln -sfn /opt/csm-controller/download /usr/local/src/csm-controller/download \
  && ln -sfn /opt/csm-controller/logs /usr/local/src/csm-controller/log
ENV SPRING_PROFILES_ACTIVE=docker
EXPOSE 8016
CMD ["sh", "-c", "java -cp 'app.jar:lib/*:resources' cn.com.rivercloud.ControllerApplication"]
