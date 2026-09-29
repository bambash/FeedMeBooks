package feedmebooks.app.reader

import android.os.Bundle
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.LinearLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.unit.dp
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.FragmentContainerView
import androidx.fragment.app.commitNow
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import feedmebooks.app.R
import feedmebooks.app.SpikeState
import feedmebooks.app.audio.Playlist
import feedmebooks.app.audio.PlaylistTranscriber
import feedmebooks.app.audio.formatDuration
import feedmebooks.core.AnchorMap
import feedmebooks.core.Handoff
import feedmebooks.core.ParagraphRef
import feedmebooks.core.TrackPosition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.readium.r2.navigator.Decoration
import org.readium.r2.navigator.epub.EpubNavigatorFactory
import org.readium.r2.navigator.epub.EpubNavigatorFragment
import org.readium.r2.shared.ExperimentalReadiumApi
import kotlin.random.Random

/**
 * The handoff spike: Readium reader on top, the audiobook (all of its files, as one
 * timeline) underneath, and buttons to switch in either direction. Also keeps the S3
 * navigation self-test (random jumps verified by reading back the visible element).
 */
@OptIn(ExperimentalReadiumApi::class)
class ReaderSpikeActivity : AppCompatActivity() {

    private lateinit var book: LoadedBook
    private var playlist: Playlist? = null
    private var player: ExoPlayer? = null
    private val navigator get() = supportFragmentManager.findFragmentByTag(NAVIGATOR_TAG) as EpubNavigatorFragment

    private var status by mutableStateOf("")
    private var busy by mutableStateOf(false)
    private var isPlaying by mutableStateOf(false)
    private val random = Random(System.currentTimeMillis())

    override fun onCreate(savedInstanceState: Bundle?) {
        val loaded = SpikeState.book
        if (loaded == null) {
            super.onCreate(null)
            finish()
            return
        }
        book = loaded
        playlist = SpikeState.playlist
        supportFragmentManager.fragmentFactory =
            EpubNavigatorFactory(book.publication).createFragmentFactory(initialLocator = null)
        super.onCreate(savedInstanceState)

        status = if (playlist == null) {
            "No audio loaded: only the navigation self-test is available."
        } else {
            "Play the audiobook, then \"Read from here\". Or scroll the book and \"Listen from here\"."
        }
        playlist?.let { list ->
            player = ExoPlayer.Builder(this).build().apply {
                setMediaItems(list.tracks.map { MediaItem.fromUri(it.uri) })
                val start = list.timeline.locate(SpikeState.lastAudioMs)
                seekTo(start.track, start.offsetMs)
                prepare()
                addListener(object : Player.Listener {
                    override fun onIsPlayingChanged(playing: Boolean) {
                        this@ReaderSpikeActivity.isPlaying = playing
                    }
                })
            }
        }

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(
            FragmentContainerView(this).apply { id = R.id.navigator_container },
            LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f),
        )
        root.addView(
            ComposeView(this).apply { setContent { ControlBar() } },
            LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT),
        )
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        setContentView(root)

        if (savedInstanceState == null) {
            supportFragmentManager.commitNow {
                add(R.id.navigator_container, EpubNavigatorFragment::class.java, Bundle(), NAVIGATOR_TAG)
            }
        }
    }

    override fun onStop() {
        super.onStop()
        // No background playback in the spike; the real app plays from a MediaSessionService.
        player?.pause()
        if (player != null) SpikeState.lastAudioMs = globalPosition()
    }

    override fun onDestroy() {
        player?.release()
        player = null
        super.onDestroy()
    }

    // ---- Audio timeline ---------------------------------------------------------------

    private fun globalPosition(): Long {
        val p = player ?: return 0
        val list = playlist ?: return 0
        return list.timeline.globalMs(TrackPosition(p.currentMediaItemIndex, p.currentPosition))
    }

    private fun seekGlobal(ms: Long) {
        val list = playlist ?: return
        val position = list.timeline.locate(ms)
        player?.seekTo(position.track, position.offsetMs)
    }

    /** "file 3/12 (Part 03.mp4) at 12:34 · book 2:13:45 / 9:02:11" */
    private fun describeAudio(ms: Long): String {
        val list = playlist ?: return ""
        val p = list.timeline.locate(ms)
        return "file ${p.track + 1}/${list.tracks.size} (${list.tracks[p.track].name}) at ${formatDuration(p.offsetMs)}" +
            " · book ${formatDuration(ms)} / ${formatDuration(list.timeline.totalMs)}"
    }

    private fun describeParagraph(p: ParagraphRef): String {
        val snippet = book.text.text.substring(p.charStart, minOf(p.charEnd, p.charStart + 70))
        return "section ${p.sectionIndex}, paragraph ${p.paragraphIndex}: \"$snippet…\""
    }

    // ---- Handoff ----------------------------------------------------------------------

    private class Prepared(val handoff: Handoff, val transcriber: PlaylistTranscriber, val loadMs: Long)

    /** Loads Whisper (first time only) and builds a Handoff over the whole audiobook. Off the main thread. */
    private suspend fun prepareHandoff(list: Playlist): Prepared? {
        val model = SpikeState.usableModel(this) ?: return null
        return withContext(Dispatchers.Default) {
            val (whisper, loadMs) = SpikeState.whisper(this@ReaderSpikeActivity, model)
            val transcriber = PlaylistTranscriber(this@ReaderSpikeActivity, list, whisper, SpikeState.threads)
            Prepared(Handoff(book.text, transcriber), transcriber, loadMs)
        }
    }

    private fun anchors(list: Playlist) = SpikeState.anchors ?: AnchorMap(book.text.length, list.timeline.totalMs)

    private fun Prepared.timings(): String =
        "transcribed ${transcriber.callsMs.size}× (${transcriber.callsMs.joinToString(" + ")} ms)" +
            (if (loadMs > 0) ", model load $loadMs ms" else "") +
            " · ${SpikeState.anchors?.anchors?.size ?: 0} anchors learned"

    /** Audio → text: where in the book is the narrator right now? */
    private suspend fun readFromHere(): String {
        val list = playlist ?: return "No audio loaded."
        val t = globalPosition()
        player?.pause()
        status = "Finding your place… listening to the 20 s before ${describeAudio(t)}"
        val prepared = prepareHandoff(list) ?: return "Download a Whisper model first (Whisper card)."
        val target = withContext(Dispatchers.Default) { prepared.handoff.audioToText(t, anchors(list)) }
        SpikeState.anchors = target.anchors
        val turns = goToParagraph(target.paragraph)
        return "READ FROM HERE ${if (target.confident) "✓ matched" else "✗ no match, estimated"}${describeTurns(turns)}\n" +
            "Audio: ${describeAudio(t)}\nBook: ${describeParagraph(target.paragraph)}\n${prepared.timings()}"
    }

    /** Text → audio: when does the narrator read the paragraph at the top of the screen? */
    private suspend fun listenFromHere(): String {
        val list = playlist ?: return "No audio loaded."
        val paragraph = topOfScreen() ?: return "Can't tell what's on screen."
        highlight(paragraph)
        status = "Finding this paragraph in the audio… ${describeParagraph(paragraph)}"
        val prepared = prepareHandoff(list) ?: return "Download a Whisper model first (Whisper card)."
        val target = withContext(Dispatchers.Default) { prepared.handoff.textToAudio(paragraph.charStart, anchors(list)) }
        SpikeState.anchors = target.anchors
        seekGlobal(maxOf(0, target.audioMs - LEAD_IN_MS))
        player?.play()
        return "LISTEN FROM HERE ${if (target.confident) "✓ matched" else "✗ not pinned down, estimated"} (${target.probes} probe(s))\n" +
            "Book: ${describeParagraph(paragraph)}\nAudio: ${describeAudio(target.audioMs)}\n${prepared.timings()}"
    }

    // ---- Reader positioning -----------------------------------------------------------

    private val probe get() = PageProbe(navigator)

    private suspend fun highlight(paragraph: ParagraphRef) {
        navigator.applyDecorations(
            listOf(Decoration("target", book.locatorOf(paragraph), Decoration.Style.Highlight(tint = HIGHLIGHT))),
            group = "handoff",
        )
    }

    /**
     * Shows [paragraph] with its first line on screen. Readium's jump can land a page off,
     * so check with the page and turn pages until it's there.
     *
     * @return pages turned to correct Readium's landing, or -1 if the page couldn't confirm it.
     */
    private suspend fun goToParagraph(paragraph: ParagraphRef): Int {
        navigator.go(book.locatorOf(paragraph), animated = false)
        highlight(paragraph)
        delay(SETTLE_MS)
        val prefix = book.compactPrefix(paragraph)
        repeat(MAX_PAGE_TURNS + 1) { turns ->
            when (probe.where(prefix)) {
                PageProbe.Where.VISIBLE -> return turns
                PageProbe.Where.AFTER -> navigator.goForward(animated = false)
                PageProbe.Where.BEFORE -> navigator.goBackward(animated = false)
                PageProbe.Where.MISSING -> return -1
            }
            delay(TURN_SETTLE_MS)
        }
        return -1
    }

    private fun describeTurns(turns: Int) = when {
        turns < 0 -> " (couldn't confirm the paragraph is on screen)"
        turns == 0 -> ""
        else -> " (corrected Readium's landing by $turns page(s))"
    }

    /** The paragraph at the top of the screen, including one continued from the previous page. */
    private suspend fun topOfScreen(): ParagraphRef? {
        val href = navigator.currentLocator.value.href.toString()
        probe.firstVisible()?.let { visible -> book.paragraphMatching(href, visible)?.let { return it } }
        // Fall back to Readium's own answer if the page probe can't map it.
        return navigator.firstVisibleElementLocator()?.let { book.paragraphOf(it) }
    }

    // ---- UI ---------------------------------------------------------------------------

    @Composable
    private fun ControlBar() {
        var position by remember { mutableStateOf("") }
        LaunchedEffect(Unit) {
            while (true) {
                if (player != null) position = describeAudio(globalPosition())
                delay(500)
            }
        }
        MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()) {
            Surface(tonalElevation = 3.dp) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(status, style = MaterialTheme.typography.bodySmall)
                    if (player != null) {
                        Text(position, style = MaterialTheme.typography.labelSmall)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            TextButton(onClick = { seekGlobal(maxOf(0, globalPosition() - 30_000)) }) { Text("−30 s") }
                            Button(onClick = { player?.let { if (it.isPlaying) it.pause() else it.play() } }) {
                                Text(if (isPlaying) "Pause" else "Play")
                            }
                            TextButton(onClick = { seekGlobal(globalPosition() + 30_000) }) { Text("+30 s") }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { launchAction { status = readFromHere() } }, enabled = !busy) { Text("Read from here") }
                            Button(onClick = { launchAction { status = listenFromHere() } }, enabled = !busy) { Text("Listen from here") }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { launchAction { status = jumpMany(10) } }, enabled = !busy) { Text("Nav test ×10") }
                        OutlinedButton(onClick = { launchAction { status = whereAmI() } }, enabled = !busy) { Text("Where am I?") }
                    }
                }
            }
        }
    }

    private fun launchAction(block: suspend () -> Unit) {
        busy = true
        lifecycleScope.launch {
            try {
                block()
            } catch (e: Exception) {
                status = "Failed: $e"
            } finally {
                busy = false
            }
        }
    }

    // ---- S3 navigation self-test ------------------------------------------------------

    /** A paragraph at least a few paragraphs into a chapter, so it's never at a chapter start. */
    private fun randomParagraph(): ParagraphRef {
        val candidates = book.text.paragraphs.filter { it.paragraphIndex >= 5 }
        return (candidates.ifEmpty { book.text.paragraphs }).random(random)
    }

    private suspend fun jumpMany(n: Int): String {
        val results = (1..n).map {
            val turns = goToParagraph(randomParagraph())
            status = "Jump $it/$n:${describeTurns(turns).ifEmpty { " landed directly ✓" }}"
            turns
        }
        val direct = results.count { it == 0 }
        val corrected = results.filter { it > 0 }
        val failed = results.count { it < 0 }
        return "NAV TEST: $n jumps: $direct landed directly, ${corrected.size} needed page turns " +
            "(${corrected.joinToString()}), $failed unconfirmed " +
            "(${book.text.paragraphs.size} paragraphs, ${book.text.words.size} words)"
    }

    /** Compares our page probe with Readium's own "first visible element". */
    private suspend fun whereAmI(): String {
        val ours = topOfScreen()
        val readium = navigator.firstVisibleElementLocator()?.let { book.paragraphOf(it) }
        fun line(p: ParagraphRef?) = p?.let {
            "${describeParagraph(it)} (${"%.1f".format(100.0 * it.charStart / book.text.length)}% of book)"
        } ?: "not found"
        return "Top of screen: ${line(ours)}\nReadium says: ${line(readium)}"
    }

    private companion object {
        const val NAVIGATOR_TAG = "navigator"
        const val SETTLE_MS = 400L
        const val TURN_SETTLE_MS = 250L
        const val MAX_PAGE_TURNS = 4
        const val HIGHLIGHT = 0xFFFFC107.toInt()
        /** Start listening slightly before the paragraph so the first words aren't clipped. */
        const val LEAD_IN_MS = 2_000L
    }
}
