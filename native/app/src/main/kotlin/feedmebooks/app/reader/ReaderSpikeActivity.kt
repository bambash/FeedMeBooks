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
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.unit.dp
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.FragmentContainerView
import androidx.fragment.app.commitNow
import androidx.lifecycle.lifecycleScope
import feedmebooks.app.R
import feedmebooks.core.ParagraphRef
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.readium.r2.navigator.Decoration
import org.readium.r2.navigator.epub.EpubNavigatorFactory
import org.readium.r2.navigator.epub.EpubNavigatorFragment
import org.readium.r2.shared.ExperimentalReadiumApi
import kotlin.random.Random
import kotlin.system.measureTimeMillis

/**
 * Spike S3: can Readium land on an arbitrary mid-chapter paragraph, highlight it, and
 * tell us precisely what is on screen? Each jump is verified by reading back the first
 * visible element and comparing it with the target.
 */
@OptIn(ExperimentalReadiumApi::class)
class ReaderSpikeActivity : AppCompatActivity() {

    private lateinit var book: LoadedBook
    private val navigator get() = supportFragmentManager.findFragmentByTag(NAVIGATOR_TAG) as EpubNavigatorFragment
    private var status by mutableStateOf("Tap a button. Jumps pick random paragraphs deep inside chapters.")
    private var busy by mutableStateOf(false)
    private val random = Random(System.currentTimeMillis())

    override fun onCreate(savedInstanceState: Bundle?) {
        val loaded = SpikeState.book
        if (loaded == null) {
            super.onCreate(null)
            finish()
            return
        }
        book = loaded
        supportFragmentManager.fragmentFactory =
            EpubNavigatorFactory(book.publication).createFragmentFactory(initialLocator = null)
        super.onCreate(savedInstanceState)

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

    @androidx.compose.runtime.Composable
    private fun ControlBar() {
        MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()) {
            Surface(tonalElevation = 3.dp) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(status, style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { launchAction { status = describe(jump(randomParagraph())) } }, enabled = !busy) { Text("Jump") }
                        Button(onClick = { launchAction { status = whereAmI() } }, enabled = !busy) { Text("Where am I?") }
                        Button(onClick = { launchAction { status = jumpMany(10) } }, enabled = !busy) { Text("Run 10") }
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

    /** A paragraph at least a few paragraphs into a long-ish chapter, so it's never at a chapter start. */
    private fun randomParagraph(): ParagraphRef {
        val candidates = book.text.paragraphs.filter { it.paragraphIndex >= 5 }
        return (candidates.ifEmpty { book.text.paragraphs }).random(random)
    }

    private class JumpResult(val target: ParagraphRef, val landed: ParagraphRef?, val settleMs: Long)

    private suspend fun jump(target: ParagraphRef): JumpResult {
        val locator = book.locatorOf(target)
        val settleMs = measureTimeMillis {
            navigator.go(locator, animated = false)
            navigator.applyDecorations(
                listOf(Decoration("target", locator, Decoration.Style.Highlight(tint = HIGHLIGHT))),
                group = "handoff",
            )
            delay(SETTLE_MS)
        }
        val landed = navigator.firstVisibleElementLocator()?.let { book.paragraphOf(it) }
        return JumpResult(target, landed, settleMs)
    }

    /** How many paragraphs before the target the screen starts (0 = target is first on screen). */
    private fun JumpResult.offset(): Int? {
        val landedAt = landed ?: return null
        return book.text.paragraphs.indexOf(target) - book.text.paragraphs.indexOf(landedAt)
    }

    private fun describe(result: JumpResult): String {
        val snippet = book.text.text.substring(result.target.charStart, minOf(result.target.charEnd, result.target.charStart + 60))
        val verdict = when (val offset = result.offset()) {
            null -> "couldn't read back the visible element"
            0 -> "target is the first paragraph on screen ✓"
            in 1..3 -> "screen starts $offset paragraph(s) above the target (same screen) ✓"
            else -> "landed $offset paragraphs away ✗"
        }
        return "Target: section ${result.target.sectionIndex}, paragraph ${result.target.paragraphIndex}: \"$snippet…\"\n$verdict"
    }

    private suspend fun jumpMany(n: Int): String {
        val offsets = (1..n).map {
            val result = jump(randomParagraph())
            status = "Jump $it/$n: ${describe(result).lines().last()}"
            result.offset()
        }
        val exact = offsets.count { it == 0 }
        val sameScreen = offsets.count { it != null && it in 1..3 }
        val missed = offsets.count { it == null || it !in 0..3 }
        return "$n jumps: $exact exact, $sameScreen same screen, $missed missed " +
            "(${book.text.paragraphs.size} paragraphs, ${book.text.words.size} words, text extracted in ${book.extractMs} ms)"
    }

    private suspend fun whereAmI(): String {
        val locator = navigator.firstVisibleElementLocator() ?: return "No visible element reported"
        val paragraph = book.paragraphOf(locator) ?: return "Visible element not found in extracted text: ${locator.href}"
        val snippet = book.text.text.substring(paragraph.charStart, minOf(paragraph.charEnd, paragraph.charStart + 80))
        val percent = 100.0 * paragraph.charStart / book.text.length
        return "charOffset ${paragraph.charStart} (${"%.1f".format(percent)}% of book), section ${paragraph.sectionIndex}, " +
            "paragraph ${paragraph.paragraphIndex}:\n\"$snippet…\""
    }

    private companion object {
        const val NAVIGATOR_TAG = "navigator"
        const val SETTLE_MS = 1_200L
        const val HIGHLIGHT = 0xFFFFC107.toInt()
    }
}
