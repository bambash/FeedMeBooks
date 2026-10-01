package feedmebooks.app.book

import android.content.Context
import feedmebooks.app.SpikeState
import feedmebooks.app.audio.Playlist
import feedmebooks.app.audio.PlaylistTranscriber
import feedmebooks.app.library.BookStore
import feedmebooks.app.reader.LoadedBook
import feedmebooks.app.whisper.ModelStore
import feedmebooks.app.whisper.Whisper
import feedmebooks.app.whisper.WhisperModel
import feedmebooks.core.AnchorMap
import feedmebooks.core.AudioTarget
import feedmebooks.core.Handoff
import feedmebooks.core.TextTarget
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** The speech model the app uses for handoffs: tiny.en measured 32× realtime on an S25 Ultra. */
object SpeechModel {
    val model = WhisperModel.TINY_EN
    const val THREADS = 4

    fun isReady(context: Context) = ModelStore.isDownloaded(context, model)

    /** Downloads on first use (≈75 MB, once), then loads and keeps it in memory. */
    suspend fun get(context: Context, onDownload: (Float) -> Unit): Whisper = withContext(Dispatchers.IO) {
        if (!isReady(context)) ModelStore.download(context, model, onDownload)
        SpikeState.whisper(context, model).first
    }
}

/**
 * One book's handoffs: wires the book text, the whole-audiobook transcriber and the
 * learned anchors together, and saves the anchors after every switch so later switches
 * start closer. Whisper isn't thread-safe, so switches are serialized.
 */
class HandoffEngine(
    private val context: Context,
    private val bookId: String,
    private val book: LoadedBook,
    private val playlist: Playlist,
) {
    private val mutex = Mutex()

    /** True once the speech model is on the device, so a probe won't start a download. */
    val ready: Boolean get() = SpeechModel.isReady(context)

    private fun anchors(): AnchorMap {
        val saved = BookStore.get(bookId)?.anchors.orEmpty()
        return AnchorMap(book.text.length, playlist.timeline.totalMs).with(*saved.toTypedArray())
    }

    private fun remember(map: AnchorMap) {
        BookStore.update(bookId) { it.copy(anchors = map.anchors) }
    }

    private suspend fun handoff(onStatus: (String) -> Unit): Handoff {
        val whisper = SpeechModel.get(context) { p -> onStatus("Downloading the speech model (one time)… ${(p * 100).toInt()}%") }
        return Handoff(book.text, PlaylistTranscriber(context, playlist, whisper, SpeechModel.THREADS))
    }

    /** Where in the book is the narrator at [audioMs]? */
    suspend fun audioToText(audioMs: Long, onStatus: (String) -> Unit): TextTarget = mutex.withLock {
        val handoff = handoff(onStatus)
        onStatus("Finding your place in the book…")
        withContext(Dispatchers.Default) { handoff.audioToText(audioMs, anchors()) }.also { remember(it.anchors) }
    }

    /** When does the narrator read [charOffset]? */
    suspend fun textToAudio(charOffset: Int, onStatus: (String) -> Unit): AudioTarget = mutex.withLock {
        val handoff = handoff(onStatus)
        onStatus("Finding this place in the audio…")
        withContext(Dispatchers.Default) { handoff.textToAudio(charOffset, anchors()) }.also { remember(it.anchors) }
    }
}
