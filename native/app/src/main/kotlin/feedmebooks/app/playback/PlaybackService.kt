package feedmebooks.app.playback

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import feedmebooks.app.library.BookStore
import feedmebooks.app.library.LibraryActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Plays the audiobook in the background. Media3 turns the session into the media
 * notification and lock-screen controls. The service also saves the listening position,
 * so it survives the UI being closed.
 *
 * Media item ids are "<bookId>#<trackIndex>", which is all the service needs to know
 * which book is playing.
 */
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate() {
        super.onCreate()
        BookStore.init(this)
        val player = ExoPlayer.Builder(this)
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(),
                /* handleAudioFocus = */ true,
            )
            .setHandleAudioBecomingNoisy(true) // pause when headphones are unplugged
            .build()
        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                savePosition(player)
            }
        })
        val openApp = PendingIntent.getActivity(
            this, 0, Intent(this, LibraryActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        session = MediaSession.Builder(this, player).setSessionActivity(openApp).build()

        scope.launch {
            while (isActive) {
                delay(SAVE_INTERVAL_MS)
                if (player.isPlaying) savePosition(player)
            }
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = session?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        scope.cancel()
        session?.run {
            savePosition(player)
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }

    private fun savePosition(player: Player) {
        val (bookId, track) = PlaybackIds.parse(player.currentMediaItem?.mediaId) ?: return
        val position = player.currentPosition
        val playing = player.isPlaying
        BookStore.update(bookId) { book ->
            val global = book.tracks.take(track).sumOf { it.durationMs } + position
            book.copy(audioMs = global, listenedAt = if (playing || global != book.audioMs) System.currentTimeMillis() else book.listenedAt)
        }
    }

    private companion object {
        const val SAVE_INTERVAL_MS = 5_000L
    }
}

object PlaybackIds {
    fun of(bookId: String, track: Int) = "$bookId#$track"

    fun parse(mediaId: String?): Pair<String, Int>? {
        val id = mediaId ?: return null
        val hash = id.lastIndexOf('#')
        if (hash < 0) return null
        return id.substring(0, hash) to (id.substring(hash + 1).toIntOrNull() ?: return null)
    }
}
