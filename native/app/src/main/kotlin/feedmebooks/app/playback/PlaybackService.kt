package feedmebooks.app.playback

import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import feedmebooks.app.R
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
 * so it survives the UI being closed, and runs the sleep timer, so it fires even when the
 * reader screen is gone.
 *
 * Media item ids are "<bookId>#<trackIndex>", which is all the service needs to know
 * which book is playing.
 */
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    /** Wall-clock time at which the sleep timer pauses playback. */
    private var sleepAt: Long? = null

    @androidx.annotation.OptIn(UnstableApi::class)
    override fun onCreate() {
        super.onCreate()
        BookStore.init(this)
        // The notification's status-bar icon is the brand mark, not Media3's generic note.
        setMediaNotificationProvider(
            DefaultMediaNotificationProvider(this).apply { setSmallIcon(R.drawable.ic_stat_feedmebooks) },
        )
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

            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                // Pausing (by hand or by losing audio focus) cancels the timer, so resuming later
                // doesn't stop again right away. Buffering doesn't count.
                if (!playWhenReady && sleepAt != null) setSleepAt(null)
            }
        })
        val openApp = PendingIntent.getActivity(
            this, 0, Intent(this, LibraryActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        session = MediaSession.Builder(this, player)
            .setSessionActivity(openApp)
            .setCallback(SessionCallback())
            .build()

        scope.launch {
            var ticks = 0L
            while (isActive) {
                delay(TICK_MS)
                if (++ticks % (SAVE_INTERVAL_MS / TICK_MS) == 0L && player.isPlaying) savePosition(player)
                tickSleepTimer(player)
            }
        }
    }

    // ---- Sleep timer ----------------------------------------------------------------------

    private fun tickSleepTimer(player: Player) {
        val at = sleepAt ?: return
        val left = at - System.currentTimeMillis()
        when {
            left <= 0 -> {
                player.pause()
                setSleepAt(null)
            }
            left <= FADE_MS -> player.volume = (left.toFloat() / FADE_MS).coerceIn(0.05f, 1f)
        }
    }

    /** Sets or clears the timer and tells controllers through the session extras. */
    private fun setSleepAt(at: Long?) {
        sleepAt = at
        // Any change undoes a fade in progress; the next tick fades again if the new deadline is close.
        session?.player?.volume = 1f
        session?.setSessionExtras(Bundle().apply { putLong(EXTRA_SLEEP_AT, at ?: 0L) })
    }

    private inner class SessionCallback : MediaSession.Callback {
        override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult =
            MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(
                    MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
                        .add(SessionCommand(COMMAND_SLEEP, Bundle.EMPTY))
                        .build(),
                )
                .build()

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            if (customCommand.customAction != COMMAND_SLEEP) {
                return Futures.immediateFuture(SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED))
            }
            setSleepAt(args.getLong(EXTRA_SLEEP_AT, 0L).takeIf { it > 0 })
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
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

    companion object {
        private const val TICK_MS = 1_000L
        private const val SAVE_INTERVAL_MS = 5_000L
        /** The volume fades over the last stretch before the timer pauses. */
        private const val FADE_MS = 20_000L

        /** Custom session command: set or clear the sleep timer. */
        const val COMMAND_SLEEP = "feedmebooks.sleep"
        /** Bundle key: wall-clock ms at which playback pauses, 0 for no timer. In command args and session extras. */
        const val EXTRA_SLEEP_AT = "sleepAt"
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
