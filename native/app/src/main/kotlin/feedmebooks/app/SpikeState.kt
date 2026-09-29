package feedmebooks.app

import android.content.Context
import feedmebooks.app.audio.Playlist
import feedmebooks.app.reader.LoadedBook
import feedmebooks.app.whisper.ModelStore
import feedmebooks.app.whisper.Whisper
import feedmebooks.app.whisper.WhisperModel
import feedmebooks.core.AnchorMap

/** Shared in-memory state for the spike screens. Nothing here is persisted yet. */
object SpikeState {
    var book: LoadedBook? = null
        set(value) {
            field = value
            anchors = null
        }

    var playlist: Playlist? = null
        set(value) {
            field = value
            anchors = null
            lastAudioMs = 0
        }

    /** Learned text ↔ audio anchors for the current book + audio pair. */
    var anchors: AnchorMap? = null

    var lastAudioMs: Long = 0

    /** Chosen in the Whisper card; the handoff screen uses the same settings. */
    var selectedModel: WhisperModel = WhisperModel.TINY_EN
    var threads: Int = 4

    private var loaded: Pair<WhisperModel, Whisper>? = null

    /** The selected model if downloaded, otherwise any downloaded model. */
    fun usableModel(context: Context): WhisperModel? =
        selectedModel.takeIf { ModelStore.isDownloaded(context, it) }
            ?: WhisperModel.entries.firstOrNull { ModelStore.isDownloaded(context, it) }

    /** Loads (or reuses) a model; returns it with the load time in ms (0 if it was already loaded). */
    @Synchronized
    fun whisper(context: Context, model: WhisperModel): Pair<Whisper, Long> {
        loaded?.takeIf { it.first == model }?.let { return it.second to 0L }
        loaded?.second?.close()
        val began = System.currentTimeMillis()
        val whisper = Whisper.load(ModelStore.file(context, model))
        loaded = model to whisper
        return whisper to System.currentTimeMillis() - began
    }
}
