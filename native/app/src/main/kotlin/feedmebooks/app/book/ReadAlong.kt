package feedmebooks.app.book

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import feedmebooks.app.reader.LoadedBook
import feedmebooks.app.reader.PageProbe
import feedmebooks.core.NarratorTracker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.readium.r2.navigator.epub.EpubNavigatorFragment

/**
 * Follows the narrator while the audio plays: highlights the sentence being read and keeps
 * it on screen, turning the page (or scrolling) as the narration moves on.
 *
 * The position comes from a [NarratorTracker]: a Whisper probe of the last few seconds of
 * audio every half minute or so, extrapolated at the narration rate in between. Probes go
 * through the [HandoffEngine], so they also improve the book's learned anchors.
 */
class ReadAlong(
    private val scope: CoroutineScope,
    private val text: LoadedBook,
    private val engine: HandoffEngine,
    private val navigator: () -> EpubNavigatorFragment,
    /** Highlight the sentence at this offset. */
    private val onShow: suspend (charOffset: Int) -> Unit,
    /** Bring this offset on screen from anywhere in the book. */
    private val onJump: suspend (charOffset: Int) -> Unit,
    /** Called before every page move we make, so it isn't mistaken for the reader turning pages. */
    private val beforeMoving: () -> Unit,
) {
    private val tracker = NarratorTracker()
    private var probe: Job? = null
    private var shown: IntRange? = null
    private var lastAudioMs: Long? = null

    /** The reader turned pages themselves while following: leave them alone until they come back. */
    var held by mutableStateOf(false)
        private set

    /** The narrator's current text position, once a probe has found it. */
    val position: Int? get() = lastAudioMs?.let { tracker.estimate(it) }

    /** Stop moving the page; the highlight still follows the narrator. */
    fun hold() {
        held = true
    }

    /** Follow again (after the reader asked to go back, or pressed play). */
    fun resume() {
        held = false
        shown = null
    }

    /** Called every half second while the audio plays and following is on. */
    suspend fun tick(audioMs: Long) {
        lastAudioMs = audioMs
        if (tracker.needsProbe(audioMs) && probe == null && engine.ready) {
            probe = scope.launch {
                runCatching { engine.audioToText(audioMs) {} }.onSuccess { tracker.fixed(it) }
                probe = null
            }
        }
        val at = tracker.estimate(audioMs) ?: return
        val sentence = text.text.sentenceAt(at)
        if (sentence == shown) return
        shown = sentence
        onShow(sentence.first)
        if (!held) keepOnScreen(sentence.first)
    }

    private suspend fun keepOnScreen(charOffset: Int) {
        val nav = navigator()
        val paragraph = text.text.paragraphAt(charOffset)
        if (text.locatorOf(paragraph).href.toString() != nav.currentLocator.value.href.toString()) {
            // Another chapter: a full jump, which also checks the landing.
            beforeMoving()
            onJump(charOffset)
            return
        }
        val probe = PageProbe(nav)
        val prefix = text.compactPrefix(paragraph)
        val at = text.compactOffsetOf(charOffset)
        val scrolling = nav.settings.value.scroll
        repeat(MAX_MOVES) {
            when (probe.where(prefix, at)) {
                PageProbe.Where.VISIBLE -> return
                PageProbe.Where.MISSING -> {
                    beforeMoving()
                    onJump(charOffset)
                    return
                }
                PageProbe.Where.AFTER -> {
                    beforeMoving()
                    if (scrolling) {
                        probe.scrollTo(prefix, at)
                        return
                    }
                    nav.goForward(animated = true)
                }
                PageProbe.Where.BEFORE -> {
                    beforeMoving()
                    if (scrolling) {
                        probe.scrollTo(prefix, at)
                        return
                    }
                    nav.goBackward(animated = true)
                }
            }
            delay(MOVE_SETTLE_MS)
        }
    }

    private companion object {
        const val MAX_MOVES = 3
        const val MOVE_SETTLE_MS = 450L
    }
}
