# 多阶段构建：Maven 打包 + JRE 运行（thin jar + lib/）
FROM maven:3.9-eclipse-temurin-8 AS build
WORKDIR /build
COPY pom.xml assembly.xml ./
COPY src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:8-jre-jammy
WORKDIR /opt/csm-controller
COPY --from=build /build/target/*.jar ./app.jar
COPY --from=build /build/target/lib ./lib
COPY --from=build /build/target/classes ./resources
RUN mkdir -p logs download
ENV SPRING_PROFILES_ACTIVE=docker
EXPOSE 8016
CMD ["sh", "-c", "java -cp 'app.jar:lib/*:resources' cn.com.rivercloud.ControllerApplication"]
