package com.facetech.backend.config;

import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.Map;
import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean(name = "taskExecutor")
    public Executor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(8);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("ocr-async-");
        // Async work logs with the requestId of the request that started it.
        executor.setTaskDecorator(AsyncConfig::withMdc);
        executor.initialize();
        return executor;
    }

    /**
     * Parallel object-store uploads of a request's images (SessionMedia). When every thread is busy the request
     * thread uploads itself, so a burst slows down instead of failing.
     */
    @Bean(name = "mediaUploadExecutor")
    public Executor mediaUploadExecutor(@Value("${camtech.media.upload-threads:16}") int threads) {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(threads);
        executor.setMaxPoolSize(threads);
        executor.setQueueCapacity(threads * 4);
        executor.setThreadNamePrefix("media-upload-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.setTaskDecorator(AsyncConfig::withMdc);
        executor.initialize();
        return executor;
    }

    private static Runnable withMdc(Runnable task) {
        Map<String, String> mdc = MDC.getCopyOfContextMap();
        return () -> {
            if (mdc != null) {
                MDC.setContextMap(mdc);
            }
            try {
                task.run();
            } finally {
                MDC.clear();
            }
        };
    }
}
