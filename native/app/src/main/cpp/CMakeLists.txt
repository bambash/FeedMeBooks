cmake_minimum_required(VERSION 3.22.1)
project(whisper_jni CXX C)

include(FetchContent)

# whisper.cpp is fetched at build time (CI has GitHub access); pinned to a release tag.
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
# Every phone this POC targets is ARMv8.2+; fp16 and dot-product kernels are the big speed win.
set(GGML_CPU_ARM_ARCH "armv8.2-a+fp16+dotprod" CACHE STRING "" FORCE)

FetchContent_Declare(
    whisper
    URL https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.2.tar.gz
)
FetchContent_MakeAvailable(whisper)

add_library(whisper_jni SHARED whisper_jni.cpp)
target_link_libraries(whisper_jni PRIVATE whisper log)
# Play requires 16 KB page-size support for apps targeting Android 15+; NDK r27 still aligns
# segments at 4 KB unless told otherwise (r28+ makes this the default).
target_link_options(whisper_jni PRIVATE "-Wl,-z,max-page-size=16384")
