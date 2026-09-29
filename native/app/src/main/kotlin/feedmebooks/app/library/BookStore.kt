package feedmebooks.app.library

import android.content.Context
import android.net.Uri
import feedmebooks.app.audio.Playlist
import feedmebooks.app.audio.Track
import feedmebooks.core.Anchor
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

data class TrackInfo(val uri: String, val name: String, val durationMs: Long)

/**
 * Everything the app remembers about one book. Positions are kept for both formats
 * independently, with timestamps so the app can tell which one is fresher.
 */
data class BookRecord(
    val id: String,
    val title: String,
    val author: String?,
    val audioFolder: String? = null,
    val tracks: List<TrackInfo> = emptyList(),
    /** Learned text ↔ audio correspondences (see AnchorMap); grow with every handoff. */
    val anchors: List<Anchor> = emptyList(),
    /** Readium locator JSON of the last reading position. */
    val readingLocator: String? = null,
    val readingProgress: Double = 0.0,
    /** When the user last turned a page themselves. */
    val readAt: Long = 0,
    /** Global position on the audiobook timeline. */
    val audioMs: Long = 0,
    /** When audio last played. */
    val listenedAt: Long = 0,
    /** When a handoff last aligned the two positions. */
    val syncedAt: Long = 0,
    val addedAt: Long = System.currentTimeMillis(),
) {
    val hasAudio: Boolean get() = tracks.isNotEmpty()
    val totalAudioMs: Long get() = tracks.sumOf { it.durationMs }

    fun playlist(): Playlist = Playlist(tracks.map { Track(Uri.parse(it.uri), it.name, it.durationMs) })

    /** Listening happened after both the last page turn and the last sync. */
    val listeningIsFresher: Boolean get() = hasAudio && listenedAt > readAt && listenedAt > syncedAt

    /** Reading happened after both the last listen and the last sync. */
    val readingIsFresher: Boolean get() = hasAudio && readAt > listenedAt && readAt > syncedAt
}

/**
 * The library, persisted as one JSON file per book under `files/library/<id>/`, next to the
 * book's EPUB and cover. Small, synchronous and good enough for a personal library.
 */
object BookStore {
    private lateinit var root: File
    private val state = MutableStateFlow<List<BookRecord>>(emptyList())
    val books: StateFlow<List<BookRecord>> get() = state

    @Synchronized
    fun init(context: Context) {
        if (::root.isInitialized) return
        root = File(context.filesDir, "library").apply { mkdirs() }
        state.value = root.listFiles().orEmpty()
            .mapNotNull { dir -> runCatching { fromJson(JSONObject(File(dir, "book.json").readText())) }.getOrNull() }
            .sortedByDescending { maxOf(it.readAt, it.listenedAt, it.addedAt) }
    }

    fun dir(id: String) = File(root, id)
    fun epubFile(id: String) = File(dir(id), "book.epub")
    fun coverFile(id: String) = File(dir(id), "cover.png")

    fun get(id: String): BookRecord? = state.value.firstOrNull { it.id == id }

    fun newId(): String = UUID.randomUUID().toString()

    @Synchronized
    fun put(book: BookRecord) {
        dir(book.id).mkdirs()
        val file = File(dir(book.id), "book.json")
        val tmp = File(dir(book.id), "book.json.tmp")
        tmp.writeText(toJson(book).toString())
        tmp.renameTo(file)
        state.value = (state.value.filterNot { it.id == book.id } + book)
            .sortedByDescending { maxOf(it.readAt, it.listenedAt, it.addedAt) }
    }

    /** Read-modify-write under the store lock. */
    @Synchronized
    fun update(id: String, change: (BookRecord) -> BookRecord): BookRecord? {
        val current = get(id) ?: return null
        return change(current).also(::put)
    }

    @Synchronized
    fun delete(id: String) {
        dir(id).deleteRecursively()
        state.value = state.value.filterNot { it.id == id }
    }

    private fun toJson(b: BookRecord) = JSONObject().apply {
        put("id", b.id)
        put("title", b.title)
        put("author", b.author)
        put("audioFolder", b.audioFolder)
        put("tracks", JSONArray(b.tracks.map { JSONObject().put("uri", it.uri).put("name", it.name).put("durationMs", it.durationMs) }))
        put("anchors", JSONArray(b.anchors.map { JSONArray().put(it.charOffset).put(it.audioMs) }))
        put("readingLocator", b.readingLocator)
        put("readingProgress", b.readingProgress)
        put("readAt", b.readAt)
        put("audioMs", b.audioMs)
        put("listenedAt", b.listenedAt)
        put("syncedAt", b.syncedAt)
        put("addedAt", b.addedAt)
    }

    private fun fromJson(o: JSONObject) = BookRecord(
        id = o.getString("id"),
        title = o.getString("title"),
        author = o.optString("author").takeIf { o.has("author") && !o.isNull("author") },
        audioFolder = o.optString("audioFolder").takeIf { o.has("audioFolder") && !o.isNull("audioFolder") },
        tracks = o.optJSONArray("tracks")?.let { a ->
            (0 until a.length()).map { i ->
                a.getJSONObject(i).let { TrackInfo(it.getString("uri"), it.getString("name"), it.getLong("durationMs")) }
            }
        }.orEmpty(),
        anchors = o.optJSONArray("anchors")?.let { a ->
            (0 until a.length()).map { i -> a.getJSONArray(i).let { Anchor(it.getInt(0), it.getLong(1)) } }
        }.orEmpty(),
        readingLocator = o.optString("readingLocator").takeIf { o.has("readingLocator") && !o.isNull("readingLocator") },
        readingProgress = o.optDouble("readingProgress", 0.0),
        readAt = o.optLong("readAt"),
        audioMs = o.optLong("audioMs"),
        listenedAt = o.optLong("listenedAt"),
        syncedAt = o.optLong("syncedAt"),
        addedAt = o.optLong("addedAt"),
    )
}
