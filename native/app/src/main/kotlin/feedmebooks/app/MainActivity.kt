package feedmebooks.app

import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import feedmebooks.core.BookText
import feedmebooks.core.Matcher
import feedmebooks.core.Section
import feedmebooks.core.TranscriptWord
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.random.Random
import kotlin.system.measureTimeMillis

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()) {
                Surface(Modifier.fillMaxSize()) { SpikeScreen() }
            }
        }
    }
}

@Composable
private fun SpikeScreen() {
    val scope = rememberCoroutineScope()
    var report by remember { mutableStateOf("Tap a check to run it on this device.") }
    var running by remember { mutableStateOf(false) }

    fun run(block: () -> String) {
        running = true
        scope.launch {
            report = withContext(Dispatchers.Default) { runCatching(block).getOrElse { "Failed: $it" } }
            running = false
        }
    }

    Column(
        Modifier.safeDrawingPadding().padding(16.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("FeedMeBooks POC", style = MaterialTheme.typography.headlineSmall)
        Text(
            "v${BuildConfig.VERSION_NAME} · ${BuildConfig.GIT_SHA} · ${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE}",
            style = MaterialTheme.typography.bodySmall,
        )
        Button(onClick = { run(::matcherSmokeTest) }, enabled = !running) { Text("Matcher smoke test") }
        Button(onClick = { run(::matcherBenchmark) }, enabled = !running) { Text("Matcher speed, novel-length book") }
        Text(if (running) "Running…" else report, style = MaterialTheme.typography.bodyMedium)
    }
}

/** Finds a misheard snippet in a tiny known text: proves :core runs on the device. */
private fun matcherSmokeTest(): String {
    val book = BookText.build(
        listOf(
            Section(
                "ch1.xhtml",
                listOf(
                    "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
                    "However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.",
                ),
            ),
        ),
    )
    val heard = "the feelings or fews of such a man may be on his first entering a neighborhood"
        .split(" ").mapIndexed { i, w -> TranscriptWord(w, i * 400L, i * 400L + 300) }
    val match = Matcher.align(heard, book, 0, book.words.size, 0, 0.4) ?: return "No match (unexpected)"
    val para = book.paragraphAt(match.pairs.first().charOffset)
    return "Matched paragraph ${para.paragraphIndex + 1} with confidence ${"%.2f".format(match.confidence)}:\n" +
        "\"${book.text.substring(match.pairs.first().charOffset, match.pairs.last().charOffset)}…\""
}

/** Worst case for a handoff: a 20 s transcript searched against a 100k-word book. */
private fun matcherBenchmark(): String {
    val rng = Random(1)
    val syllables = listOf("ka", "ro", "mi", "ten", "sul", "ve", "dra", "nor", "pel", "ith", "gar", "lo")
    val vocab = List(5000) { List(rng.nextInt(1, 4)) { syllables.random(rng) }.joinToString("") }
    val sections = List(30) { s ->
        Section("ch$s.xhtml", List(40) { List(84) { vocab.random(rng) }.joinToString(" ") })
    }
    lateinit var book: BookText
    val buildMs = measureTimeMillis { book = BookText.build(sections) }
    val at = book.words.size * 3 / 4
    val heard = (at until at + 55).map { book.words[it].norm }.mapIndexed { i, w -> TranscriptWord(w, i * 360L, i * 360L + 300) }
    var wholeBookMs = 0L
    var windowMs = 0L
    repeat(3) {
        wholeBookMs += measureTimeMillis { Matcher.align(heard, book, 0, book.words.size, at, 0.4) }
        windowMs += measureTimeMillis { Matcher.align(heard, book, at - 10_000, at + 10_000, at, 0.4) }
    }
    return "Book: ${book.words.size} words, indexed in ${buildMs} ms\n" +
        "55-word transcript, whole-book search: ${wholeBookMs / 3} ms\n" +
        "55-word transcript, ±10k-word window: ${windowMs / 3} ms"
}
