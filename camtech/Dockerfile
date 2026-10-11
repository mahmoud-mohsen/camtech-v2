# The jar is built by the pipeline's build job (mvn -s .m2/settings.xml clean install).
# glibc-based image (not alpine): the bundled OpenCV native library needs glibc.
FROM eclipse-temurin:21-jre

WORKDIR /app

ARG JAR_FILE=target/camtech-service.jar
COPY ${JAR_FILE} app.jar

# Non-root user (uid 1001, matched by the k8s securityContext) owning the
# image storage directory.
RUN groupadd -r -g 1001 appgroup && useradd -r -u 1001 -g appgroup appuser \
    && mkdir -p /app/uploads \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 8080

# Heap sized from the container memory limit (the default is only 25%), leaving room for OpenCV's native memory and
# thread stacks; on OutOfMemoryError the JVM exits so k8s restarts the pod instead of it limping on.
# Override per deployment with JAVA_OPTS.
ENV JAVA_OPTS="-XX:MaxRAMPercentage=70 -XX:InitialRAMPercentage=50 -XX:+UseG1GC -XX:+ExitOnOutOfMemoryError"

CMD ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
