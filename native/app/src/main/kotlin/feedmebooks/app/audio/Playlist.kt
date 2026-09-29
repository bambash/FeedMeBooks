package feedmebooks.app.audio

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import feedmebooks.app.whisper.AudioDecoder
import feedmebooks.app.whisper.Whisper
import feedmebooks.core.AudioTimeline
import feedmebooks.core.NaturalOrder
import feedmebooks.core.Transcriber
import feedmebooks.core.TranscriptWord

data class Track(val uri: Uri, val name: String, val durationMs: Long)

/** An audiobook's files in reading order, joined into one [AudioTimeline]. */
class Playlist(val tracks: List<Track>) {
    val timeline = AudioTimeline(tracks.map { it.durationMs })

    /** 16 kHz mono PCM for a global time range, stitched across file boundaries. */
    fun decode(context: Context, fromMs: Long, toMs: Long): FloatArray {
        val parts = timeline.slices(fromMs, toMs).map { slice ->
            AudioDecoder.decode(context, tracks[slice.track].uri, slice.fromMs, slice.toMs - slice.fromMs)
        }
        val out = FloatArray(parts.sumOf { it.size })
        var at = 0
        for (p in parts) {
            p.copyInto(out, at)
            at += p.size
        }
        return out
    }

    companion object {
        private val AUDIO_EXTENSIONS = setOf("mp4", "m4a", "m4b", "mp3", "aac", "ogg", "opus", "flac", "wav")

        /** Every audio file directly inside a picked folder, in natural filename order. */
        fun fromFolder(context: Context, treeUri: Uri, onProgress: (String) -> Unit): Playlist {
            val folder = DocumentFile.fromTreeUri(context, treeUri) ?: error("Can't open folder")
            val files = folder.listFiles()
                .filter { it.isFile && it.name?.substringAfterLast('.', "")?.lowercase() in AUDIO_EXTENSIONS }
                .sortedWith(compareBy(NaturalOrder) { it.name ?: "" })
            require(files.isNotEmpty()) { "No audio files in that folder" }
            val tracks = files.mapIndexed { i, f ->
                onProgress("Reading durations… ${i + 1}/${files.size}")
                Track(f.uri, f.name ?: "track ${i + 1}", AudioDecoder.durationMs(context, f.uri))
            }
            return Playlist(tracks)
        }
    }
}

/** A [Transcriber] over a whole multi-file audiobook, recording how long each call took. */
class PlaylistTranscriber(
    private val context: Context,
    private val playlist: Playlist,
    private val whisper: Whisper,
    private val threads: Int,
) : Transcriber {
    val callsMs = ArrayList<Long>()

    override fun transcribe(startMs: Long, endMs: Long): List<TranscriptWord> {
        val began = System.currentTimeMillis()
        val samples = playlist.decode(context, startMs, endMs)
        val words = if (samples.isEmpty()) emptyList() else whisper.transcribe(samples, startMs, threads)
        callsMs += System.currentTimeMillis() - began
        return words
    }
}

/** 3725000 → "1:02:05", 65000 → "1:05". */
fun formatDuration(ms: Long): String {
    val s = ms / 1000
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
}
