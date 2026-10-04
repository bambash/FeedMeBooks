package feedmebooks.app.book

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.LinearLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.FragmentContainerView
import androidx.fragment.app.commitNow
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import feedmebooks.app.R
import feedmebooks.app.audio.formatDuration
import feedmebooks.app.library.BookRecord
import feedmebooks.app.library.BookStore
import feedmebooks.app.playback.PlayerLink
import feedmebooks.app.reader.LoadedBook
import feedmebooks.app.reader.PageProbe
import feedmebooks.app.reader.PageScroller
import feedmebooks.app.reader.ReaderPrefs
import feedmebooks.app.reader.ReaderSettings
import feedmebooks.app.reader.isSystemDark
import feedmebooks.app.ui.AppTheme
import feedmebooks.app.ui.Brand
import feedmebooks.app.ui.ReaderSettingsSheet
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.readium.r2.navigator.Decoration
import org.readium.r2.navigator.epub.EpubNavigatorFactory
import org.readium.r2.navigator.epub.EpubNavigatorFragment
import org.readium.r2.navigator.input.InputListener
import org.readium.r2.navigator.input.TapEvent
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.publication.Locator
import kotlin.math.roundToInt

/**
 * Reading and listening to one book. The reader fills the screen; the audiobook plays in
 * [feedmebooks.app.playback.PlaybackService] and is controlled from the bar at the bottom.
 *
 * Handoff is offered rather than forced: when you come back to the book after listening, it
 * offers to jump to where the narrator is; when you press play after reading, it offers to
 * start the audio from the page you're on. Selecting text offers to play from that passage.
 * While the audio plays, [ReadAlong] highlights the sentence being read and keeps it on screen
 * (unless turned off in the settings).
 *
 * In the scrolled layout, sideways swipes don't change chapters (Readium's own rule fired on
 * almost any flick); the page edges and a "Next chapter" chip do, and an auto-scroll with a
 * speed dial rolls through the book by itself.
 */
@OptIn(ExperimentalReadiumApi::class)
class BookActivity : AppCompatActivity() {

    private lateinit var opened: OpenBooks.OpenBook
    private lateinit var bookId: String
    private lateinit var root: LinearLayout
    private val navigator get() = supportFragmentManager.findFragmentByTag(NAVIGATOR_TAG) as EpubNavigatorFragment
    private val record: BookRecord? get() = BookStore.get(bookId)
    private val contents: List<TocEntry> by lazy { opened.publication.tocEntries() }

    private var link by mutableStateOf<PlayerLink?>(null)
    private var engine: HandoffEngine? = null
    private var readAlong by mutableStateOf<ReadAlong?>(null)
    private var banner by mutableStateOf<Banner?>(null)
    private var isPlaying by mutableStateOf(false)
    private var speed by mutableStateOf(1f)
    private var positionText by mutableStateOf("")
    private var sleepLeftMs by mutableStateOf<Long?>(null)
    private var location by mutableStateOf<Locator?>(null)
    /** Tapping the middle of the page hides the bar for distraction-free reading. */
    private var barVisible by mutableStateOf(true)
    private var sheet by mutableStateOf<Sheet?>(null)
    /** Scroll mode: the resource is scrolled to its end, so offer the next chapter. */
    private var atChapterEnd by mutableStateOf(false)
    private var autoScrolling by mutableStateOf(false)
    private var autoScrollJob: Job? = null

    private enum class Sheet { SETTINGS, CONTENTS, SLEEP }

    /** Page changes before this time are ours (jumps, initial layout, following the narrator), not the reader turning pages. */
    private var programmaticUntil = 0L
    private var highlighted = false

    private sealed interface Banner {
        data class Working(val message: String) : Banner
        data class Info(val message: String) : Banner
        data class Offer(val message: String, val quote: String?, val accept: String, val decline: String,
                         val onAccept: () -> Unit, val onDecline: () -> Unit) : Banner
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        bookId = intent.getStringExtra(EXTRA_BOOK_ID).orEmpty()
        ReaderSettings.init(this)
        val current = OpenBooks.current?.takeIf { it.bookId == bookId }
        val book = BookStore.get(bookId)
        if (current == null || book == null) {
            // Process was recreated without the publication; go back to the library.
            super.onCreate(null)
            finish()
            return
        }
        opened = current
        val initial = book.readingLocator?.let { runCatching { Locator.fromJSON(JSONObject(it)) }.getOrNull() }
        val prefs = ReaderSettings.prefs.value
        supportFragmentManager.fragmentFactory = EpubNavigatorFactory(opened.publication)
            .createFragmentFactory(
                initialLocator = initial,
                initialPreferences = prefs.epubPreferences(isSystemDark()),
                // Otherwise, in scroll mode, any flick with a sideways component jumps a whole chapter.
                configuration = EpubNavigatorFragment.Configuration(
                    disablePageTurnsWhileScrolling = true,
                    selectionActionModeCallback = selectionMenu,
                ),
            )
        super.onCreate(savedInstanceState)

        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(
            FragmentContainerView(this).apply { id = R.id.navigator_container },
            LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f),
        )
        root.addView(
            ComposeView(this).apply { setContent { AppTheme(windowColors = false) { BottomBar() } } },
            LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT),
        )
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        setContentView(root)
        applyTheme(prefs)
        if (savedInstanceState == null) {
            supportFragmentManager.commitNow {
                add(R.id.navigator_container, EpubNavigatorFragment::class.java, Bundle(), NAVIGATOR_TAG)
            }
        }

        programmaticUntil = System.currentTimeMillis() + INITIAL_LAYOUT_MS
        navigator.addInputListener(tapZones)
        lifecycleScope.launch { navigator.currentLocator.collect { onLocatorChanged(it) } }
        lifecycleScope.launch {
            // Settings changed from the sheet: restyle the page and the window right away.
            ReaderSettings.prefs.drop(1).collect { p ->
                navigator.submitPreferences(p.epubPreferences(isSystemDark()))
                applyTheme(p)
                if (!p.scroll && autoScrolling) setAutoScroll(false)
            }
        }
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    poll()
                    delay(TICK_MS)
                }
            }
        }

        if (book.hasAudio) {
            lifecycleScope.launch {
                val connected = PlayerLink.connect(this@BookActivity, book)
                link = connected
                speed = connected.speed
                val text = opened.text.await()
                val eng = HandoffEngine(this@BookActivity, bookId, text, book.playlist())
                engine = eng
                readAlong = ReadAlong(
                    scope = lifecycleScope,
                    text = text,
                    engine = eng,
                    navigator = { navigator },
                    onShow = { highlight(text, it) },
                    onJump = { goTo(text, it) },
                    beforeMoving = { programmaticUntil = System.currentTimeMillis() + JUMP_SETTLE_MS },
                )
                offerReadingIfListenedMore()
            }
        }
    }

    override fun onRestart() {
        super.onRestart()
        // Back from the background: maybe the book was being listened to meanwhile.
        if (engine != null) lifecycleScope.launch { offerReadingIfListenedMore() }
    }

    override fun onStop() {
        if (autoScrolling) setAutoScroll(false)
        super.onStop()
    }

    override fun onDestroy() {
        link?.release()
        super.onDestroy()
    }

    /** The window and the strip around the reader match the page colour, so nothing flashes white. */
    private fun applyTheme(prefs: ReaderPrefs) {
        val systemDark = isSystemDark()
        val background = prefs.readiumTheme(systemDark).backgroundColor
        root.setBackgroundColor(background)
        window.decorView.setBackgroundColor(background)
        @Suppress("DEPRECATION")
        window.statusBarColor = background
        @Suppress("DEPRECATION")
        window.navigationBarColor = background
        WindowCompat.getInsetsController(window, root).isAppearanceLightStatusBars = !prefs.isDark(systemDark)
    }

    /** Every half second while on screen: the player's state, and the narrator's position if following. */
    private suspend fun poll() {
        val scrolled = navigator.settings.value.scroll
        atChapterEnd = scrolled && !autoScrolling &&
            PageScroller(navigator).atEdge().let { it == PageScroller.Edge.BOTTOM || it == PageScroller.Edge.BOTH }
        val player = link ?: return
        val position = player.position()
        isPlaying = player.isPlaying
        positionText = describe(position)
        sleepLeftMs = player.sleepAt?.let { (it - System.currentTimeMillis()).coerceAtLeast(0) }
        val follow = readAlong ?: return
        if (isPlaying && ReaderSettings.prefs.value.followNarrator) follow.tick(position)
    }

    /** Tap the edges to turn pages, the middle to show or hide the bar. */
    private val tapZones = object : InputListener {
        override fun onTap(event: TapEvent): Boolean {
            val width = navigator.view?.width?.takeIf { it > 0 } ?: return false
            when {
                event.point.x < width * TAP_EDGE -> pageBackward()
                event.point.x > width * (1 - TAP_EDGE) -> pageForward()
                else -> barVisible = !barVisible
            }
            return true
        }
    }

    /**
     * The menu over selected text: play the audiobook from the selection, or copy it. (Providing
     * a menu replaces the system one, so Copy is added back.) The selection is read before
     * the menu closes, because closing it may deselect the text.
     */
    private val selectionMenu = object : ActionMode.Callback {
        override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
            if (record?.hasAudio == true) menu.add(Menu.NONE, MENU_PLAY_FROM_SELECTION, 0, "Play from here")
            menu.add(Menu.NONE, MENU_COPY, 1, android.R.string.copy)
            return true
        }

        override fun onPrepareActionMode(mode: ActionMode, menu: Menu) = false

        override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
            if (item.itemId != MENU_PLAY_FROM_SELECTION && item.itemId != MENU_COPY) return false
            lifecycleScope.launch {
                val selection = navigator.currentSelection()?.locator
                navigator.clearSelection()
                mode.finish()
                when (item.itemId) {
                    MENU_PLAY_FROM_SELECTION -> listenFromSelection(selection)
                    MENU_COPY -> selection?.text?.highlight?.let {
                        getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText(null, it))
                    }
                }
            }
            return true
        }

        override fun onDestroyActionMode(mode: ActionMode) {}
    }

    // ---- Moving through the book ----------------------------------------------------------

    /** A page forward: the next column, or in scroll mode a screenful down (then the next chapter). */
    private fun pageForward() {
        if (!navigator.settings.value.scroll) {
            navigator.goForward(animated = true)
            return
        }
        lifecycleScope.launch { if (!PageScroller(navigator).scrollBy(SCREENFUL)) nextChapter() }
    }

    private fun pageBackward() {
        if (!navigator.settings.value.scroll) {
            navigator.goBackward(animated = true)
            return
        }
        lifecycleScope.launch { if (!PageScroller(navigator).scrollBy(-SCREENFUL)) previousChapter() }
    }

    private fun resourceIndex(): Int {
        val href = navigator.currentLocator.value.href.toString().substringBefore('#')
        return opened.publication.readingOrder.indexOfFirst { it.href.toString().substringBefore('#') == href }
    }

    /** Opens the start of the next resource in the reading order; false at the end of the book. */
    private fun nextChapter(): Boolean {
        val index = resourceIndex()
        if (index < 0) return false
        val next = opened.publication.readingOrder.getOrNull(index + 1) ?: return false
        return navigator.go(next, animated = false)
    }

    /** Opens the end of the previous resource; false at the start of the book. */
    private fun previousChapter(): Boolean {
        val index = resourceIndex()
        if (index <= 0) return false
        val previous = opened.publication.readingOrder[index - 1]
        val end = opened.publication.locatorFromLink(previous)?.copyWithLocations(progression = 1.0) ?: return false
        return navigator.go(end, animated = false)
    }

    /**
     * Auto-scroll: the page rolls down at the speed on the dial, continuing into the next
     * chapter, until the end of the book, the layout changes, or the screen is left.
     */
    private fun setAutoScroll(on: Boolean) {
        autoScrolling = on
        autoScrollJob?.cancel()
        autoScrollJob = null
        if (!on) {
            lifecycleScope.launch { runCatching { PageScroller(navigator).autoScroll(0.0) } }
            return
        }
        autoScrollJob = lifecycleScope.launch {
            val scroller = PageScroller(navigator)
            while (isActive) {
                val more = scroller.autoScroll(ReaderSettings.prefs.value.autoScrollPxPerSecond)
                if (!more) {
                    if (!nextChapter()) {
                        setAutoScroll(false)
                        return@launch
                    }
                    delay(CHAPTER_LOAD_MS)
                }
                delay(AUTO_SCROLL_TICK_MS)
            }
        }
    }

    // ---- Reading position ------------------------------------------------------------

    private fun onLocatorChanged(locator: Locator) {
        location = locator
        val userTurn = System.currentTimeMillis() > programmaticUntil
        BookStore.update(bookId) {
            it.copy(
                readingLocator = locator.toJSON().toString(),
                readingProgress = locator.locations.totalProgression ?: it.readingProgress,
                readAt = if (userTurn) System.currentTimeMillis() else it.readAt,
            )
        }
        if (userTurn) {
            if (highlighted) {
                highlighted = false
                lifecycleScope.launch { navigator.applyDecorations(emptyList(), HIGHLIGHT_GROUP) }
            }
            // Turning pages while the narrator reads means looking around: stop moving the page until asked.
            if (isPlaying) readAlong?.hold()
        }
    }

    /** Book offset of the first line on screen (which may be mid-paragraph). */
    private suspend fun topOfScreen(text: LoadedBook): Int? {
        val href = navigator.currentLocator.value.href.toString()
        PageProbe(navigator).firstVisible()?.let { visible ->
            text.paragraphMatching(href, visible)?.let { return text.charOffsetOf(it, visible.skipped) }
        }
        return navigator.firstVisibleElementLocator()?.let { text.paragraphOf(it)?.charStart }
    }

    /** Shows [charOffset] with its line on screen and the sentence highlighted. */
    private suspend fun goTo(text: LoadedBook, charOffset: Int) {
        val paragraph = text.text.paragraphAt(charOffset)
        programmaticUntil = System.currentTimeMillis() + JUMP_SETTLE_MS
        navigator.go(text.locatorOf(paragraph), animated = false)
        highlight(text, charOffset)
        delay(SETTLE_MS)
        val probe = PageProbe(navigator)
        val prefix = text.compactPrefix(paragraph)
        val at = text.compactOffsetOf(charOffset)
        val scrolled = navigator.settings.value.scroll
        repeat(MAX_PAGE_TURNS) {
            programmaticUntil = System.currentTimeMillis() + JUMP_SETTLE_MS
            val where = probe.where(prefix, at)
            if (where != PageProbe.Where.AFTER && where != PageProbe.Where.BEFORE) return
            if (scrolled) {
                // One smooth scroll lands it; the loop is for column layouts.
                probe.scrollTo(prefix, at)
                return
            }
            if (where == PageProbe.Where.AFTER) navigator.goForward(animated = false) else navigator.goBackward(animated = false)
            delay(TURN_SETTLE_MS)
        }
    }

    private suspend fun highlight(text: LoadedBook, charOffset: Int) {
        val paragraph = text.text.paragraphAt(charOffset)
        val dark = ReaderSettings.prefs.value.isDark(isSystemDark())
        navigator.applyDecorations(
            listOf(
                Decoration(
                    "paragraph", text.locatorOf(paragraph),
                    Decoration.Style.Highlight(tint = if (dark) Brand.PARAGRAPH_TINT_DARK else Brand.PARAGRAPH_TINT),
                ),
                Decoration(
                    "sentence", text.sentenceLocator(charOffset),
                    Decoration.Style.Highlight(tint = if (dark) Brand.SENTENCE_TINT_DARK else Brand.SENTENCE_TINT),
                ),
            ),
            HIGHLIGHT_GROUP,
        )
        highlighted = true
    }

    private fun quote(text: LoadedBook, charOffset: Int): String {
        val s = text.text.sentenceAt(charOffset)
        val sentence = text.text.text.substring(s.first, s.last + 1)
        return if (sentence.length > QUOTE_MAX) sentence.take(QUOTE_MAX).trimEnd() + "…" else sentence
    }

    private fun markSynced() = BookStore.update(bookId) { it.copy(syncedAt = System.currentTimeMillis()) }

    // ---- Handoff: audio → text ----------------------------------------------------------

    /** Offer to jump to the narrator's position if listening happened since the last read or sync. */
    private suspend fun offerReadingIfListenedMore() {
        val book = record ?: return
        val player = link ?: return
        if (!book.listeningIsFresher || player.isPlaying || banner != null) return
        findNarrator(player.position(), offered = true)
    }

    private suspend fun findNarrator(audioMs: Long, offered: Boolean) {
        val eng = engine ?: return
        val text = opened.text.await()
        banner = Banner.Working("Finding where you were listening…")
        val target = runCatching { eng.audioToText(audioMs) { banner = Banner.Working(it) } }
            .getOrElse { banner = Banner.Info("Couldn't find your place: ${it.message}"); return }
        val jump = {
            banner = null
            markSynced()
            readAlong?.resume()
            lifecycleScope.launch { goTo(text, target.charOffset) }
            Unit
        }
        if (!offered) {
            jump()
            return
        }
        banner = Banner.Offer(
            message = if (target.confident) "You were listening. Continue reading where the narrator is?"
            else "You were listening. Jump to about where the narrator is? (couldn't pin it down exactly)",
            quote = quote(text, target.charOffset),
            accept = "Jump there",
            decline = "Stay here",
            onAccept = jump,
            onDecline = { banner = null; markSynced() },
        )
    }

    /** Back to the narrator after the reader wandered off while the audio played. */
    private fun backToNarrator() {
        val follow = readAlong ?: return
        follow.resume()
        val at = follow.position ?: return
        lifecycleScope.launch { goTo(opened.text.await(), at) }
    }

    // ---- Handoff: text → audio ----------------------------------------------------------

    private fun onPlayPressed() {
        val player = link ?: return
        if (player.isPlaying) {
            player.pause()
            return
        }
        readAlong?.resume()
        val book = record ?: return
        if (!book.readingIsFresher || engine == null) {
            player.play()
            return
        }
        banner = Banner.Offer(
            message = "You've been reading. Start the audio from this page?",
            quote = null,
            accept = "From this page",
            decline = "Where I left off",
            onAccept = { lifecycleScope.launch { listenFromPage() } },
            onDecline = { banner = null; markSynced(); player.play() },
        )
    }

    private suspend fun listenFromPage() {
        val text = opened.text.await()
        val charOffset = topOfScreen(text) ?: run { banner = Banner.Info("Can't tell what's on screen."); return }
        listenFrom(text, charOffset, what = "this page")
    }

    /** Text the reader selected: start the audio where the narrator reads its first words. */
    private suspend fun listenFromSelection(selection: Locator?) {
        val text = opened.text.await()
        val charOffset = selection?.let { text.selectionStart(it) }
            ?: run { banner = Banner.Info("Couldn't find the selected text in the book."); return }
        listenFrom(text, charOffset, what = "this passage")
    }

    /** Finds where the narrator reads [charOffset] and plays from just before it. [what] names it in messages. */
    private suspend fun listenFrom(text: LoadedBook, charOffset: Int, what: String) {
        val player = link ?: return
        val eng = engine ?: run { banner = Banner.Info("Still connecting to the player…"); return }
        highlight(text, charOffset)
        banner = Banner.Working("Finding $what in the audio…")
        val target = runCatching { eng.textToAudio(charOffset) { banner = Banner.Working(it) } }
            .getOrElse { banner = Banner.Info("Couldn't find $what in the audio: ${it.message}"); return }
        player.seekTo(maxOf(0, target.audioMs - LEAD_IN_MS))
        readAlong?.resume()
        player.play()
        markSynced()
        banner = if (target.confident) null else Banner.Info("Started near $what (couldn't pin it down exactly).")
    }

    // ---- UI ---------------------------------------------------------------------------

    @Composable
    private fun BottomBar() {
        val prefs by ReaderSettings.prefs.collectAsState()
        var menu by remember { mutableStateOf(false) }
        val book = record
        val player = link
        val follow = readAlong

        when (sheet) {
            Sheet.SETTINGS -> ReaderSettingsSheet(showFollow = book?.hasAudio == true) { sheet = null }
            Sheet.CONTENTS -> ContentsSheet(
                entries = contents,
                current = location,
                onPick = { entry ->
                    sheet = null
                    navigator.go(entry.link, animated = false)
                },
                onDismiss = { sheet = null },
            )
            Sheet.SLEEP -> SleepTimerDialog(
                remainingMs = sleepLeftMs,
                onPick = { minutes ->
                    sheet = null
                    player?.sleepIn(minutes?.let { it * 60_000L })
                },
                onDismiss = { sheet = null },
            )
            null -> {}
        }

        Surface(tonalElevation = 3.dp) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                banner?.let { BannerCard(it) }
                if (!barVisible) return@Column

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            contents.entryFor(location)?.title ?: book?.title.orEmpty(),
                            style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                        location?.locations?.totalProgression?.let {
                            Text("${(it * 100).toInt()}% read", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                    if (atChapterEnd && !autoScrolling) {
                        FilledTonalButton(onClick = { nextChapter() }) {
                            Text("Next chapter")
                            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null)
                        }
                    }
                    if (prefs.scroll) {
                        TextButton(onClick = { setAutoScroll(!autoScrolling) }) { Text(if (autoScrolling) "Stop" else "Auto") }
                    }
                    IconButton(onClick = { sheet = Sheet.CONTENTS }) { Icon(Icons.AutoMirrored.Filled.List, contentDescription = "Contents") }
                    TextButton(onClick = { sheet = Sheet.SETTINGS }) { Text("Aa") }
                }
                if (autoScrolling) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Speed", style = MaterialTheme.typography.labelMedium)
                        Slider(
                            value = prefs.autoScrollSpeed.toFloat(),
                            onValueChange = { v -> ReaderSettings.update { it.copy(autoScrollSpeed = v.roundToInt()) } },
                            valueRange = ReaderPrefs.AUTO_SCROLL_MIN.toFloat()..ReaderPrefs.AUTO_SCROLL_MAX.toFloat(),
                            steps = ReaderPrefs.AUTO_SCROLL_MAX - ReaderPrefs.AUTO_SCROLL_MIN - 1,
                            modifier = Modifier.weight(1f),
                        )
                        Text("${prefs.autoScrollSpeed}", style = MaterialTheme.typography.labelMedium)
                    }
                }

                if (book?.hasAudio != true) {
                    Text("No audiobook for this book yet. Add its folder from the library.", style = MaterialTheme.typography.bodySmall)
                    return@Column
                }
                if (player == null) {
                    Text("Connecting to the player…", style = MaterialTheme.typography.bodySmall)
                    return@Column
                }
                if (follow?.held == true && isPlaying && prefs.followNarrator) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("The narrator has moved on.", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                        FilledTonalButton(onClick = ::backToNarrator) { Text("Back to the narrator") }
                    }
                }
                Text(
                    positionText + (sleepLeftMs?.let { " · sleep in ${formatDuration(it)}" } ?: ""),
                    style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    IconButton(onClick = { player.seekTo(maxOf(0, player.position() - 30_000)) }) {
                        Icon(painterResource(R.drawable.ic_replay_30), contentDescription = "Back 30 seconds")
                    }
                    FilledIconButton(onClick = ::onPlayPressed, modifier = Modifier.size(52.dp)) {
                        Icon(
                            painterResource(if (isPlaying) R.drawable.ic_pause else R.drawable.ic_play),
                            contentDescription = if (isPlaying) "Pause" else "Play",
                            modifier = Modifier.size(30.dp),
                        )
                    }
                    IconButton(onClick = { player.seekTo(player.position() + 30_000) }) {
                        Icon(painterResource(R.drawable.ic_forward_30), contentDescription = "Forward 30 seconds")
                    }
                    TextButton(onClick = {
                        val next = SPEEDS.firstOrNull { it > speed + 0.01f } ?: SPEEDS.first()
                        player.speed = next
                        speed = next
                    }) { Text("${"%.2f".format(speed).trimEnd('0').trimEnd('.')}×") }
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "More") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("Go to the narrator's position") }, onClick = {
                                menu = false
                                player.pause()
                                lifecycleScope.launch { findNarrator(player.position(), offered = false) }
                            })
                            DropdownMenuItem(text = { Text("Play from this page") }, onClick = {
                                menu = false
                                lifecycleScope.launch { listenFromPage() }
                            })
                            DropdownMenuItem(
                                text = { Text("Follow the narrator") },
                                trailingIcon = { if (prefs.followNarrator) Icon(Icons.Filled.Check, contentDescription = "On") },
                                onClick = {
                                    menu = false
                                    ReaderSettings.update { it.copy(followNarrator = !it.followNarrator) }
                                },
                            )
                            DropdownMenuItem(
                                text = { Text(sleepLeftMs?.let { "Sleep timer · ${formatDuration(it)} left" } ?: "Sleep timer…") },
                                leadingIcon = { Icon(painterResource(R.drawable.ic_sleep), contentDescription = null) },
                                onClick = {
                                    menu = false
                                    sheet = Sheet.SLEEP
                                },
                            )
                        }
                    }
                }
            }
        }
    }

    @Composable
    private fun BannerCard(b: Banner) {
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                when (b) {
                    is Banner.Working -> {
                        Text(b.message, style = MaterialTheme.typography.bodyMedium)
                        LinearProgressIndicator(Modifier.fillMaxWidth())
                    }
                    is Banner.Info -> Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(b.message, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                        TextButton(onClick = { banner = null }) { Text("OK") }
                    }
                    is Banner.Offer -> {
                        Text(b.message, style = MaterialTheme.typography.bodyMedium)
                        b.quote?.let { Text("“$it”", style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis) }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilledTonalButton(onClick = b.onAccept) { Text(b.accept) }
                            TextButton(onClick = b.onDecline) { Text(b.decline) }
                        }
                    }
                }
            }
        }
    }

    private fun describe(globalMs: Long): String {
        val book = record ?: return ""
        val player = link ?: return ""
        val p = player.timeline.locate(globalMs)
        return "${formatDuration(globalMs)} / ${formatDuration(book.totalAudioMs)} · " +
            "file ${p.track + 1}/${book.tracks.size} at ${formatDuration(p.offsetMs)}"
    }

    companion object {
        private const val EXTRA_BOOK_ID = "bookId"
        private const val NAVIGATOR_TAG = "navigator"
        private const val HIGHLIGHT_GROUP = "handoff"
        private const val MENU_PLAY_FROM_SELECTION = 1
        private const val MENU_COPY = 2
        private const val TICK_MS = 500L
        private const val INITIAL_LAYOUT_MS = 2_500L
        private const val JUMP_SETTLE_MS = 1_500L
        private const val SETTLE_MS = 400L
        private const val TURN_SETTLE_MS = 250L
        private const val MAX_PAGE_TURNS = 5
        private const val LEAD_IN_MS = 1_500L
        private const val QUOTE_MAX = 220
        /** Fraction of the page width on each side that turns pages when tapped. */
        private const val TAP_EDGE = 0.22f
        /** How much of the screen an edge tap scrolls in scroll mode. */
        private const val SCREENFUL = 0.85
        private const val AUTO_SCROLL_TICK_MS = 300L
        private const val CHAPTER_LOAD_MS = 800L
        private val SPEEDS = listOf(0.8f, 1f, 1.2f, 1.5f, 1.75f, 2f)

        fun intent(context: Context, bookId: String) =
            Intent(context, BookActivity::class.java).putExtra(EXTRA_BOOK_ID, bookId)
    }
}
