#include <jni.h>
#include <string>

#include "whisper.h"

extern "C" {

JNIEXPORT jlong JNICALL
Java_feedmebooks_app_whisper_WhisperNative_load(JNIEnv *env, jobject, jstring path) {
    const char *p = env->GetStringUTFChars(path, nullptr);
    whisper_context_params params = whisper_context_default_params();
    params.use_gpu = false;
    whisper_context *ctx = whisper_init_from_file_with_params(p, params);
    env->ReleaseStringUTFChars(path, p);
    return reinterpret_cast<jlong>(ctx);
}

JNIEXPORT void JNICALL
Java_feedmebooks_app_whisper_WhisperNative_free(JNIEnv *, jobject, jlong handle) {
    whisper_free(reinterpret_cast<whisper_context *>(handle));
}

// One line per text token: "t0_ms\tt1_ms\ttext\n". Returned as raw UTF-8 bytes because a
// token can end mid-character, which JNI's modified-UTF-8 string functions reject.
JNIEXPORT jbyteArray JNICALL
Java_feedmebooks_app_whisper_WhisperNative_transcribe(
        JNIEnv *env, jobject, jlong handle, jfloatArray samples, jint threads) {
    auto *ctx = reinterpret_cast<whisper_context *>(handle);

    whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.n_threads = threads;
    params.language = "en";
    params.translate = false;
    params.no_context = true;
    params.token_timestamps = true;
    params.print_progress = false;
    params.print_realtime = false;
    params.print_special = false;
    params.print_timestamps = false;

    jsize n = env->GetArrayLength(samples);
    jfloat *data = env->GetFloatArrayElements(samples, nullptr);
    int rc = whisper_full(ctx, params, data, n);
    env->ReleaseFloatArrayElements(samples, data, JNI_ABORT);
    if (rc != 0) return nullptr;

    std::string out;
    const whisper_token eot = whisper_token_eot(ctx);
    for (int i = 0; i < whisper_full_n_segments(ctx); ++i) {
        for (int j = 0; j < whisper_full_n_tokens(ctx, i); ++j) {
            whisper_token_data d = whisper_full_get_token_data(ctx, i, j);
            if (d.id >= eot) continue; // special and timestamp tokens
            out += std::to_string(d.t0 * 10);
            out += '\t';
            out += std::to_string(d.t1 * 10);
            out += '\t';
            out += whisper_full_get_token_text(ctx, i, j);
            out += '\n';
        }
    }

    jbyteArray result = env->NewByteArray(static_cast<jsize>(out.size()));
    env->SetByteArrayRegion(result, 0, static_cast<jsize>(out.size()),
                            reinterpret_cast<const jbyte *>(out.data()));
    return result;
}

} // extern "C"
