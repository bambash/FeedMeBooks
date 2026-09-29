package feedmebooks.app.playback

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import feedmebooks.app.library.BookRecord
import feedmebooks.app.library.BookStore
import feedmebooks.core.AudioTimeline
import feedmebooks.core.TrackPosition
import kotlinx.coroutines.guava.await

/**
 * The UI's handle on [PlaybackService]: loads a book's files as one playlist and speaks in
 * global audiobook time, so callers never deal with individual files.
 */
class PlayerLink private constructor(val controller: MediaController, private val bookId: String, tracks: List<Long>) {
    val timeline = AudioTimeline(tracks)

    val isPlaying: Boolean get() = controller.isPlaying

    fun position(): Long =
        if (isThisBook()) timeline.globalMs(TrackPosition(controller.currentMediaItemIndex, controller.currentPosition)) else 0

    fun seekTo(globalMs: Long) {
        val p = timeline.locate(globalMs)
        controller.seekTo(p.track, p.offsetMs)
    }

    fun play() = controller.play()
    fun pause() = controller.pause()

    var speed: Float
        get() = controller.playbackParameters.speed
        set(value) = controller.setPlaybackSpeed(value)

    private fun isThisBook() = PlaybackIds.parse(controller.currentMediaItem?.mediaId)?.first == bookId

    fun release() = controller.release()

    companion object {
        /** Connects to the service and makes sure [book] is the loaded playlist, at its saved position. */
        suspend fun connect(context: Context, book: BookRecord): PlayerLink {
            val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
            val controller = MediaController.Builder(context, token).buildAsync().await()
            val link = PlayerLink(controller, book.id, book.tracks.map { it.durationMs })
            val loaded = PlaybackIds.parse(controller.currentMediaItem?.mediaId)?.first == book.id &&
                controller.mediaItemCount == book.tracks.size
            if (!loaded) {
                val cover = BookStore.coverFile(book.id).takeIf { it.exists() }?.let { Uri.fromFile(it) }
                val items = book.tracks.mapIndexed { i, t ->
                    MediaItem.Builder()
                        .setUri(t.uri)
                        .setMediaId(PlaybackIds.of(book.id, i))
                        .setMediaMetadata(
                            MediaMetadata.Builder()
                                .setTitle(book.title)
                                .setArtist(book.author)
                                .setAlbumTitle(book.title)
                                .setSubtitle(t.name)
                                .setTrackNumber(i + 1)
                                .setTotalTrackCount(book.tracks.size)
                                .setArtworkUri(cover)
                                .build(),
                        )
                        .build()
                }
                val start = link.timeline.locate(book.audioMs)
                controller.setMediaItems(items, start.track, start.offsetMs)
                controller.prepare()
            }
            return link
        }
    }
}
