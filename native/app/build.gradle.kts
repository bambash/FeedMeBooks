import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    kotlin("android")
    kotlin("plugin.compose")
}

android {
    namespace = "feedmebooks.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.feedmebooks.poc"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "0.1.${System.getenv("GITHUB_RUN_NUMBER") ?: "0"}"
        buildConfigField("String", "GIT_SHA", "\"${System.getenv("GITHUB_SHA")?.take(7) ?: "local"}\"")
    }

    signingConfigs {
        // A throwaway key committed on purpose: every CI build is signed the same way,
        // so a new APK installs over the old one. Not for store distribution.
        create("poc") {
            storeFile = file("poc-signing.keystore")
            storePassword = "feedmebooks"
            keyAlias = "poc"
            keyPassword = "feedmebooks"
        }
    }

    buildTypes {
        // Release, not debug: native code (whisper.cpp) must be optimized for honest benchmarks.
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("poc")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":core"))

    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
