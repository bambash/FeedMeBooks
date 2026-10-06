package feedmebooks.app.library

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import feedmebooks.app.BuildConfig
import feedmebooks.app.R
import feedmebooks.app.audio.Playlist
import feedmebooks.app.audio.formatDuration
import feedmebooks.app.book.BookActivity
import feedmebooks.app.book.OpenBooks
import feedmebooks.app.book.SpeechModel
import feedmebooks.app.reader.LoadedBook
import feedmebooks.app.ui.AppTheme
import feedmebooks.app.ui.ReaderSettingsSheet
import feedmebooks.app.whisper.ModelStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.readium.r2.shared.publication.services.cover

/** Opens the Lab (POC builds only); declared by the `poc` manifest. */
private const val LAB_ACTION = "feedmebooks.app.action.LAB"

/** The launcher: your books, with reading and listening progress, and adding new ones. */
class LibraryActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        BookStore.init(this)
        setContent {
            AppTheme { LibraryScreen() }
        }
    }
}

@Composable
private fun LibraryScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val books by BookStore.books.collectAsState()
    var busy by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var settings by remember { mutableStateOf(false) }
    /** Book waiting for its audio folder (right after import, or from the card menu). */
    var audioFor by remember { mutableStateOf<String?>(null) }

    val pickFolder = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        val id = audioFor ?: return@rememberLauncherForActivityResult
        audioFor = null
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            busy = "Reading the audiobook files…"
            error = runCatching { withContext(Dispatchers.IO) { attachAudio(context, id, uri) { busy = it } } }
                .exceptionOrNull()?.let { "Couldn't add the audio: ${it.message}" }
            busy = null
            ensureSpeechModel(context) { busy = it }
        }
    }
    val pickEpub = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            busy = "Adding the book…"
            val result = runCatching { withContext(Dispatchers.IO) { importEpub(context, uri) } }
            busy = null
            result.onSuccess { id ->
                audioFor = id
                pickFolder.launch(null)
            }.onFailure { error = "Couldn't add the book: ${it.message}" }
        }
    }

    Scaffold(
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { pickEpub.launch(arrayOf("application/epub+zip")) },
                icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                text = { Text("Add book") },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            Row(
                Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Image(painterResource(R.drawable.ic_brand_mark), contentDescription = null, modifier = Modifier.size(30.dp))
                Text(stringResource(R.string.app_name), style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
                if (BuildConfig.LAB) {
                    // The spike screens live in the `poc` source set; store builds don't contain them.
                    TextButton(onClick = { context.startActivity(Intent(LAB_ACTION).setPackage(context.packageName)) }) { Text("Lab") }
                }
                IconButton(onClick = { settings = true }) { Icon(Icons.Filled.Settings, contentDescription = "Settings") }
            }
            if (settings) ReaderSettingsSheet(showFollow = true) { settings = false }
            busy?.let {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Text(it, style = MaterialTheme.typography.bodySmall)
                    LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 4.dp))
                }
            }
            error?.let {
                Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f))
                    TextButton(onClick = { error = null }) { Text("OK") }
                }
            }
            if (books.isEmpty() && busy == null) EmptyLibrary()
            LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(books, key = { it.id }) { book ->
                    BookCard(
                        book = book,
                        onOpen = {
                            scope.launch {
                                busy = "Opening ${book.title}…"
                                runCatching { OpenBooks.open(context, book) }
                                    .onSuccess { context.startActivity(BookActivity.intent(context, book.id)) }
                                    .onFailure { error = "Couldn't open the book: ${it.message}" }
                                busy = null
                            }
                        },
                        onSetAudio = {
                            audioFor = book.id
                            pickFolder.launch(null)
                        },
                        onRemove = { BookStore.delete(book.id) },
                    )
                }
            }
        }
    }
}

/** The first thing a new user sees: the mark, the promise, and what to do. */
@Composable
private fun EmptyLibrary() {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Image(painterResource(R.drawable.ic_brand_mark), contentDescription = null, modifier = Modifier.size(96.dp))
        Text(stringResource(R.string.app_tagline), style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
        Text(
            "Add a book: pick its EPUB, then the folder with its audiobook files. " +
                "Switch between reading and listening whenever you like; the other one picks up where you are.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

/** One book: cover, title, and how far it has been read (ink) and listened to (amber). */
@Composable
private fun BookCard(book: BookRecord, onOpen: () -> Unit, onSetAudio: () -> Unit, onRemove: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val cover = remember(book.id) { loadCover(book.id) }
    val colors = MaterialTheme.colorScheme
    Card(Modifier.fillMaxWidth().clickable(onClick = onOpen)) {
        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(Modifier.size(60.dp, 90.dp).clip(MaterialTheme.shapes.small).background(colors.surfaceVariant)) {
                cover?.let { Image(it.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
                    ?: Image(
                        painterResource(R.drawable.ic_brand_mark), contentDescription = null,
                        modifier = Modifier.size(32.dp).align(Alignment.Center),
                    )
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(book.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                book.author?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant) }
                Spacer(Modifier.height(6.dp))
                Progress(
                    label = "Read ${(book.readingProgress * 100).toInt()}%",
                    fraction = book.readingProgress.toFloat(),
                    color = colors.primary,
                )
                if (book.hasAudio) {
                    Progress(
                        label = "Listened ${formatDuration(book.audioMs)} of ${formatDuration(book.totalAudioMs)} · ${book.tracks.size} files",
                        fraction = if (book.totalAudioMs > 0) book.audioMs.toFloat() / book.totalAudioMs else 0f,
                        color = colors.tertiary,
                    )
                } else {
                    Text("No audiobook yet", style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
                }
            }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "More") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text(if (book.hasAudio) "Change audio folder" else "Add audio folder") }, onClick = { menu = false; onSetAudio() })
                    DropdownMenuItem(text = { Text("Remove from library") }, onClick = { menu = false; onRemove() })
                }
            }
        }
    }
}

@Composable
private fun Progress(label: String, fraction: Float, color: Color) {
    Text(label, style = MaterialTheme.typography.bodySmall)
    LinearProgressIndicator(
        progress = { fraction.coerceIn(0f, 1f) },
        color = color,
        trackColor = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth().padding(top = 2.dp, bottom = 4.dp),
    )
}

private fun loadCover(id: String): Bitmap? =
    BookStore.coverFile(id).takeIf { it.exists() }?.let { BitmapFactory.decodeFile(it.path) }

/** Copies the EPUB into app storage, reads its title, author and cover, and creates the record. */
private suspend fun importEpub(context: Context, uri: Uri): String {
    val id = BookStore.newId()
    val file = BookStore.epubFile(id)
    file.parentFile?.mkdirs()
    context.contentResolver.openInputStream(uri)!!.use { input -> file.outputStream().use { input.copyTo(it) } }
    val publication = LoadedBook.openPublication(context, file)
    try {
        publication.cover()?.let { bitmap ->
            val scale = minOf(1f, COVER_MAX_PX / maxOf(bitmap.width, bitmap.height).toFloat())
            val scaled = Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true)
            BookStore.coverFile(id).outputStream().use { scaled.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        BookStore.put(
            BookRecord(
                id = id,
                title = publication.metadata.title ?: "Untitled",
                author = publication.metadata.authors.firstOrNull()?.name,
            ),
        )
    } finally {
        publication.close()
    }
    return id
}

/** Keeps read access to the folder across restarts and records its files, in natural order, with durations. */
private fun attachAudio(context: Context, id: String, treeUri: Uri, onProgress: (String) -> Unit) {
    context.contentResolver.takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    val playlist = Playlist.fromFolder(context, treeUri, onProgress)
    BookStore.update(id) { book ->
        book.copy(
            audioFolder = treeUri.toString(),
            tracks = playlist.tracks.map { TrackInfo(it.uri.toString(), it.name, it.durationMs) },
            // New audio invalidates everything learned about the old one.
            anchors = emptyList(),
            audioMs = 0,
            listenedAt = 0,
        )
    }
}

/** Fetch the speech model in the background right after the first audiobook is added. */
private suspend fun ensureSpeechModel(context: Context, onStatus: (String?) -> Unit) {
    if (SpeechModel.isReady(context)) return
    runCatching {
        withContext(Dispatchers.IO) {
            ModelStore.download(context, SpeechModel.model) { p -> onStatus("Downloading the speech model (one time)… ${(p * 100).toInt()}%") }
        }
    }
    onStatus(null)
}

private const val COVER_MAX_PX = 600f
