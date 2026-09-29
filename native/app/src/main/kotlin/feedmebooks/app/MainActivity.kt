package feedmebooks.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import feedmebooks.app.reader.LoadedBook
import feedmebooks.app.reader.ReaderSpikeActivity
import feedmebooks.app.reader.SpikeState
import feedmebooks.app.whisper.AudioDecoder
import feedmebooks.app.whisper.ModelStore
import feedmebooks.app.whisper.Whisper
import feedmebooks.app.whisper.WhisperModel
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
    Column(
        Modifier.safeDrawingPadding().padding(16.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("FeedMeBooks POC", style = MaterialTheme.typography.headlineSmall)
        Text(
            "v${BuildConfig.VERSION_NAME} · ${BuildConfig.GIT_SHA} · ${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE}",
            style = MaterialTheme.typography.bodySmall,
        )
        WhisperCard()
        ReaderCard()
        MatcherCard()
    }
}

@Composable
private fun SpikeCard(title: String, subtitle: String, content: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(subtitle, style = MaterialTheme.typography.bodySmall)
            content()
        }
    }
}

/**
 * MP4 audiobooks are often typed video/mp4 by the file provider, so audio/* alone hides them.
 * MediaExtractor picks the audio track either way.
 */
private val AUDIOBOOK_TYPES = arrayOf("audio/*", "video/mp4")

/** Spike S2: how fast is on-device Whisper on a 20 s slice of a real MP3? */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WhisperCard() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var model by remember { mutableStateOf(WhisperModel.TINY_EN) }
    var threads by remember { mutableStateOf(4) }
    var audio by remember { mutableStateOf<Uri?>(null) }
    var audioMs by remember { mutableStateOf(0L) }
    var startSec by remember { mutableStateOf("") }
    var report by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var loaded by remember { mutableStateOf<Pair<WhisperModel, Whisper>?>(null) }
    var downloadedVersion by remember { mutableStateOf(0) } // bump to recheck files
    val downloaded = remember(model, downloadedVersion) { ModelStore.isDownloaded(context, model) }

    val pickAudio = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            audio = uri
            scope.launch {
                audioMs = withContext(Dispatchers.IO) { AudioDecoder.durationMs(context, uri) }
                startSec = (audioMs / 1000 / 3).toString()
            }
        }
    }

    SpikeCard("Whisper speed", "Transcribes 20 s of an audiobook file (MP4/M4A/M4B/MP3) on this phone. Target: under 5 s.") {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            WhisperModel.entries.forEach { m ->
                FilterChip(selected = model == m, onClick = { model = m }, label = { Text("${m.label} (${m.approxMb} MB)") })
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(2, 4, 6, 8).forEach { t ->
                FilterChip(selected = threads == t, onClick = { threads = t }, label = { Text("$t threads") })
            }
        }
        if (!downloaded) {
            Button(enabled = !busy, onClick = {
                busy = true
                scope.launch {
                    report = try {
                        withContext(Dispatchers.IO) {
                            ModelStore.download(context, model) { p -> report = "Downloading ${model.label}… ${(p * 100).toInt()}%" }
                        }
                        downloadedVersion++
                        "Downloaded ${model.label}."
                    } catch (e: Exception) {
                        "Download failed: $e"
                    }
                    busy = false
                }
            }) { Text("Download ${model.label}") }
        }
        OutlinedButton(onClick = { pickAudio.launch(AUDIOBOOK_TYPES) }, enabled = !busy) {
            Text(if (audio == null) "Pick an audiobook file" else "${audio?.lastPathSegment?.substringAfterLast('/')} (${audioMs / 60_000} min)")
        }
        OutlinedTextField(
            value = startSec,
            onValueChange = { startSec = it.filter(Char::isDigit) },
            label = { Text("Start at (seconds)") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            singleLine = true,
        )
        Button(enabled = !busy && downloaded && audio != null, onClick = {
            val uri = audio ?: return@Button
            busy = true
            report = "Running…"
            scope.launch {
                report = try {
                    withContext(Dispatchers.Default) {
                        val startMs = (startSec.toLongOrNull() ?: 0L) * 1000
                        lateinit var samples: FloatArray
                        val decodeMs = measureTimeMillis { samples = AudioDecoder.decode(context, uri, startMs, 20_000) }
                        var loadMs = 0L
                        val whisper = loaded?.takeIf { it.first == model }?.second ?: run {
                            loaded?.second?.close()
                            lateinit var w: Whisper
                            loadMs = measureTimeMillis { w = Whisper.load(ModelStore.file(context, model)) }
                            loaded = model to w
                            w
                        }
                        lateinit var words: List<TranscriptWord>
                        val transcribeMs = measureTimeMillis { words = whisper.transcribe(samples, startMs, threads) }
                        val audioSec = samples.size / AudioDecoder.SAMPLE_RATE.toDouble()
                        buildString {
                            appendLine("${model.label}, $threads threads, ${"%.1f".format(audioSec)} s of audio")
                            appendLine("Decode ${decodeMs} ms · model load ${if (loadMs > 0) "$loadMs ms" else "cached"} · transcribe $transcribeMs ms")
                            appendLine("${"%.1f".format(audioSec * 1000 / transcribeMs)}× realtime · ${words.size} words")
                            appendLine()
                            append(words.joinToString(" ") { "[${"%.1f".format(it.startMs / 1000.0)}]${it.text}" })
                        }
                    }
                } catch (e: Throwable) {
                    "Failed: $e"
                }
                busy = false
            }
        }) { Text("Transcribe 20 s") }
        if (report.isNotEmpty()) Text(report, style = MaterialTheme.typography.bodySmall)
    }
}

/** Spike S3: can Readium land precisely on a mid-chapter paragraph? */
@Composable
private fun ReaderCard() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var report by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val pickEpub = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        busy = true
        scope.launch {
            report = try {
                val book = withContext(Dispatchers.IO) { LoadedBook.open(context, uri) { report = it } }
                SpikeState.book = book
                context.startActivity(Intent(context, ReaderSpikeActivity::class.java))
                "${book.title}: ${book.text.sectionCount} sections, ${book.text.paragraphs.size} paragraphs, " +
                    "${book.text.words.size} words (text extracted in ${book.extractMs} ms)"
            } catch (e: Throwable) {
                "Failed: $e"
            }
            busy = false
        }
    }
    SpikeCard("Reader navigation", "Opens an EPUB in Readium, jumps to random mid-chapter paragraphs and checks where it landed.") {
        Button(onClick = { pickEpub.launch(arrayOf("application/epub+zip")) }, enabled = !busy) { Text("Open an EPUB") }
        if (SpikeState.book != null && !busy) {
            OutlinedButton(onClick = { context.startActivity(Intent(context, ReaderSpikeActivity::class.java)) }) {
                Text("Reopen reader")
            }
        }
        if (report.isNotEmpty()) Text(report, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun MatcherCard() {
    val scope = rememberCoroutineScope()
    var report by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    fun run(block: () -> String) {
        busy = true
        scope.launch {
            report = withContext(Dispatchers.Default) { runCatching(block).getOrElse { "Failed: $it" } }
            busy = false
        }
    }
    SpikeCard("Matcher", "Measured on an S25 Ultra: 24 ms whole-book, 8 ms windowed.") {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { run(::matcherSmokeTest) }, enabled = !busy) { Text("Smoke test") }
            OutlinedButton(onClick = { run(::matcherBenchmark) }, enabled = !busy) { Text("Speed") }
        }
        if (report.isNotEmpty()) Text(report, style = MaterialTheme.typography.bodySmall)
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
