package feedmebooks.app.whisper

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import java.nio.ByteOrder

/** Decodes a slice of an audio file into what Whisper wants: 16 kHz mono float PCM. */
object AudioDecoder {
    const val SAMPLE_RATE = 16_000

    fun durationMs(context: Context, uri: Uri): Long = MediaMetadataRetriever().run {
        try {
            setDataSource(context, uri)
            extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
        } finally {
            release()
        }
    }

    fun decode(context: Context, uri: Uri, startMs: Long, durationMs: Long): FloatArray {
        val extractor = MediaExtractor()
        extractor.setDataSource(context, uri, null)
        val track = (0 until extractor.trackCount).first {
            extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
        }
        extractor.selectTrack(track)
        val format = extractor.getTrackFormat(track)
        val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
        codec.configure(format, null, null, 0)
        codec.start()

        val startUs = startMs * 1000
        val endUs = (startMs + durationMs) * 1000
        extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

        var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        var mono = FloatArray(((durationMs / 1000 + 2) * sampleRate).toInt())
        var count = 0
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var outputDone = false
        try {
            while (!outputDone) {
                if (!inputDone) {
                    val inIndex = codec.dequeueInputBuffer(10_000)
                    if (inIndex >= 0) {
                        val buffer = codec.getInputBuffer(inIndex)!!
                        val size = extractor.readSampleData(buffer, 0)
                        if (size < 0 || extractor.sampleTime > endUs) {
                            codec.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(inIndex, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                val outIndex = codec.dequeueOutputBuffer(info, 10_000)
                if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    sampleRate = codec.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    channels = codec.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                } else if (outIndex >= 0) {
                    val pcm = codec.getOutputBuffer(outIndex)!!.order(ByteOrder.nativeOrder()).asShortBuffer()
                    val frames = pcm.remaining() / channels
                    for (f in 0 until frames) {
                        val t = info.presentationTimeUs + f * 1_000_000L / sampleRate
                        var sum = 0f
                        for (c in 0 until channels) sum += pcm.get()
                        if (t < startUs || t >= endUs) continue
                        if (count == mono.size) mono = mono.copyOf(mono.size * 2)
                        mono[count++] = sum / channels / 32768f
                    }
                    codec.releaseOutputBuffer(outIndex, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                }
            }
        } finally {
            codec.stop()
            codec.release()
            extractor.release()
        }
        return resample(mono, count, sampleRate)
    }

    /** Box-filtered resampling: averaging over each output step is a cheap anti-aliasing filter for speech. */
    private fun resample(input: FloatArray, length: Int, fromRate: Int): FloatArray {
        if (fromRate == SAMPLE_RATE) return input.copyOf(length)
        val ratio = fromRate.toDouble() / SAMPLE_RATE
        val out = FloatArray((length / ratio).toInt())
        for (i in out.indices) {
            val from = (i * ratio).toInt()
            val to = minOf(length, maxOf(from + 1, ((i + 1) * ratio).toInt()))
            var sum = 0f
            for (k in from until to) sum += input[k]
            out[i] = sum / (to - from)
        }
        return out
    }
}
