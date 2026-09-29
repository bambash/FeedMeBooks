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
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreVert
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
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import feedmebooks.app.LabActivity
import feedmebooks.app.audio.Playlist
import feedmebooks.app.audio.formatDuration
import feedmebooks.app.book.BookActivity
import feedmebooks.app.book.OpenBooks
import feedmebooks.app.book.SpeechModel
import feedmebooks.app.reader.LoadedBook
import feedmebooks.app.whisper.ModelStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.readium.r2.shared.publication.services.cover

/** The launcher: your books, with reading and listening progress, and adding new ones. */
class LibraryActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        BookStore.init(this)
        setContent {
            MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()) {
                LibraryScreen()
            }
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
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Library", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
                TextButton(onClick = { context.startActivity(Intent(context, LabActivity::class.java)) }) { Text("Lab") }
            }
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
            if (books.isEmpty() && busy == null) {
                Text(
                    "Add a book: pick its EPUB, then the folder with its audiobook files.",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(16.dp),
                )
            }
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

@Composable
private fun BookCard(book: BookRecord, onOpen: () -> Unit, onSetAudio: () -> Unit, onRemove: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val cover = remember(book.id) { loadCover(book.id) }
    Card(Modifier.fillMaxWidth().clickable(onClick = onOpen)) {
        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(56.dp, 84.dp).background(MaterialTheme.colorScheme.surfaceVariant)) {
                cover?.let { Image(it.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(book.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                book.author?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                Text("Read ${(book.readingProgress * 100).toInt()}%", style = MaterialTheme.typography.bodySmall)
                Text(
                    if (book.hasAudio) "Listened ${formatDuration(book.audioMs)} of ${formatDuration(book.totalAudioMs)} · ${book.tracks.size} files"
                    else "No audiobook yet",
                    style = MaterialTheme.typography.bodySmall,
                )
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
