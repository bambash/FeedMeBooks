import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    kotlin("android")
    kotlin("plugin.compose")
}

/**
 * Store signing comes from the environment, never from the repo: CI decodes the upload
 * keystore from secrets into `app/upload.keystore` (gitignored) and exports these four
 * variables. Without them the release build is left unsigned, which still compiles.
 */
val storeKeystore = System.getenv("FEEDMEBOOKS_KEYSTORE_FILE")?.let(::file)?.takeIf { it.exists() }

android {
    namespace = "feedmebooks.app"
    compileSdk = 36

    defaultConfig {
        // The store id is com.feedmebooks.app; the POC build adds ".poc" and stays installable alongside it.
        applicationId = "com.feedmebooks"
        minSdk = 26
        // Play requires API 36 for new apps and updates since 2026-08-31.
        targetSdk = 36
        // Play needs a strictly increasing versionCode. The release workflow passes VERSION_CODE
        // (its run number) and VERSION_NAME (the tag); the POC workflow and local builds fall back.
        versionCode = (System.getenv("VERSION_CODE") ?: System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = System.getenv("VERSION_NAME") ?: "0.1.${System.getenv("GITHUB_RUN_NUMBER") ?: "0"}"
        buildConfigField("String", "GIT_SHA", "\"${System.getenv("GITHUB_SHA")?.take(7) ?: "local"}\"")
        buildConfigField("boolean", "LAB", "false")

        // One ABI keeps the bundle small and the native build fast; every current Android phone is arm64.
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
        // A throwaway key committed on purpose: every POC build is signed the same way,
        // so a new APK installs over the old one. Never used for the store build.
        create("poc") {
            storeFile = file("poc-signing.keystore")
            storePassword = "feedmebooks"
            keyAlias = "poc"
            keyPassword = "feedmebooks"
        }
        if (storeKeystore != null) {
            create("store") {
                storeFile = storeKeystore
                storePassword = System.getenv("FEEDMEBOOKS_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("FEEDMEBOOKS_KEY_ALIAS")
                keyPassword = System.getenv("FEEDMEBOOKS_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        // The store build: com.feedmebooks.app, signed with the upload key when it is present.
        release {
            applicationIdSuffix = ".app"
            isMinifyEnabled = false
            signingConfig = storeKeystore?.let { signingConfigs.getByName("store") }
        }
        // The CI/POC build: same optimized code (whisper.cpp must be optimized for honest
        // benchmarks), plus the Lab screens, under the id and key every POC APK has had.
        create("poc") {
            initWith(getByName("release"))
            applicationIdSuffix = ".poc"
            signingConfig = signingConfigs.getByName("poc")
            buildConfigField("boolean", "LAB", "true")
            matchingFallbacks += "release"
        }
    }

    lint {
        // lifecycle 2.9's bundled lint checks crashed lint's release gate on older AGP; keep the
        // gate off until it is verified clean. Lint still runs on demand (./gradlew :app:lint).
        checkReleaseBuilds = false
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        // Readium uses java.time etc. below its minSdk and ships with desugaring enabled.
        isCoreLibraryDesugaringEnabled = true
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
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")

    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.appcompat:appcompat:1.7.0")
    // The launch screen (the mark on ink) on every Android version the app supports.
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.fragment:fragment-ktx:1.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("androidx.documentfile:documentfile:1.0.1")
    // Same Media3 version Readium's navigator depends on.
    implementation("androidx.media3:media3-exoplayer:1.7.1")
    implementation("androidx.media3:media3-session:1.7.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-guava:1.10.2")
    implementation("androidx.compose.material:material-icons-core")

    // 3.1.x needs no newer compileSdk; 3.2+ (compileSdk 36) is now an option but untested on a device.
    val readium = "3.1.2"
    implementation("org.readium.kotlin-toolkit:readium-shared:$readium")
    implementation("org.readium.kotlin-toolkit:readium-streamer:$readium")
    implementation("org.readium.kotlin-toolkit:readium-navigator:$readium")
}
