package feedmebooks.app.whisper

import android.content.Context
import feedmebooks.core.TranscriptWord
import java.io.Closeable
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

internal object WhisperNative {
    init {
        System.loadLibrary("whisper_jni")
    }

    external fun load(modelPath: String): Long
    external fun free(handle: Long)
    external fun transcribe(handle: Long, samples: FloatArray, threads: Int): ByteArray?
}

enum class WhisperModel(val fileName: String, val label: String, val approxMb: Int) {
    TINY_EN("ggml-tiny.en.bin", "tiny.en", 75),
    BASE_EN("ggml-base.en.bin", "base.en", 142),
}

/** A loaded model. Not thread-safe: run one transcription at a time. */
class Whisper private constructor(private var handle: Long) : Closeable {

    /**
     * Transcribes 16 kHz mono [samples]. Word times are shifted by [offsetMs] so they land
     * on the caller's timeline (e.g. the global audiobook timeline).
     */
    fun transcribe(samples: FloatArray, offsetMs: Long, threads: Int): List<TranscriptWord> {
        check(handle != 0L) { "closed" }
        val raw = WhisperNative.transcribe(handle, samples, threads) ?: error("whisper_full failed")
        val words = ArrayList<TranscriptWord>()
        var text = StringBuilder()
        var start = 0L
        var end = 0L
        fun flush() {
            if (text.isNotBlank()) words += TranscriptWord(text.toString().trim(), offsetMs + start, offsetMs + end)
            text = StringBuilder()
        }
        for (line in String(raw, Charsets.UTF_8).lineSequence()) {
            val parts = line.split('\t', limit = 3)
            if (parts.size < 3) continue
            val t0 = parts[0].toLongOrNull() ?: continue
            val t1 = parts[1].toLongOrNull() ?: continue
            val token = parts[2]
            // Whisper tokens that begin with a space start a new word; others continue the current one.
            if (token.startsWith(" ") || text.isEmpty()) {
                flush()
                start = t0
            }
            text.append(token)
            end = t1
        }
        flush()
        return words
    }

    override fun close() {
        if (handle != 0L) WhisperNative.free(handle)
        handle = 0
    }

    companion object {
        fun load(file: File): Whisper {
            val handle = WhisperNative.load(file.absolutePath)
            require(handle != 0L) { "Could not load model ${file.name}" }
            return Whisper(handle)
        }
    }
}

object ModelStore {
    private const val BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/"

    fun file(context: Context, model: WhisperModel) = File(context.filesDir, "models/${model.fileName}")

    fun isDownloaded(context: Context, model: WhisperModel) = file(context, model).exists()

    /** Blocking download with progress in 0–1. Writes to a temp file first so a partial download never counts. */
    fun download(context: Context, model: WhisperModel, onProgress: (Float) -> Unit): File {
        val target = file(context, model)
        target.parentFile?.mkdirs()
        val part = File(target.path + ".part")
        val connection = URL(BASE_URL + model.fileName).openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = true
        try {
            connection.connect()
            check(connection.responseCode == 200) { "HTTP ${connection.responseCode}" }
            val total = connection.contentLengthLong
            connection.inputStream.use { input ->
                part.outputStream().use { output ->
                    val buffer = ByteArray(1 shl 16)
                    var done = 0L
                    var lastReport = 0L
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n)
                        done += n
                        if (total > 0 && done - lastReport > total / 100) {
                            lastReport = done
                            onProgress(done.toFloat() / total)
                        }
                    }
                }
            }
        } finally {
            connection.disconnect()
        }
        check(part.renameTo(target)) { "Could not save model" }
        return target
    }
}
