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

        // One ABI keeps the APK small and the native build fast; every current Android phone is arm64.
        ndk { abiFilters += "arm64-v8a" }
        externalNativeBuild {
            cmake { arguments += listOf("-DCMAKE_BUILD_TYPE=Release") }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
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
        optIn.add("org.readium.r2.shared.ExperimentalReadiumApi")
    }
}

dependencies {
    implementation(project(":core"))

    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.fragment:fragment-ktx:1.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    // 3.1.x is the newest line that builds against compileSdk 35 (3.2+ needs 36).
    val readium = "3.1.2"
    implementation("org.readium.kotlin-toolkit:readium-shared:$readium")
    implementation("org.readium.kotlin-toolkit:readium-streamer:$readium")
    implementation("org.readium.kotlin-toolkit:readium-navigator:$readium")
}
