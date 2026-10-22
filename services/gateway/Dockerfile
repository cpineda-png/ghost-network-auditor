FROM eclipse-temurin:17-jdk AS build
WORKDIR /src
COPY mvnw pom.xml ./
COPY .mvn .mvn
COPY src src
RUN chmod +x mvnw && ./mvnw -q -DskipTests package

FROM eclipse-temurin:17-jre
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/*.jar app.jar
EXPOSE 8081
ENTRYPOINT ["java", "-Dloader.path=/drivers", "-jar", "app.jar"]
