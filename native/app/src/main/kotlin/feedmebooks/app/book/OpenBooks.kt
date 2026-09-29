package feedmebooks.app.book

import android.content.Context
import feedmebooks.app.library.BookRecord
import feedmebooks.app.library.BookStore
import feedmebooks.app.reader.LoadedBook
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.withContext
import org.readium.r2.shared.publication.Publication

/**
 * The book currently open in the reader. Readium needs the publication before the reader
 * activity is created, so the library opens it first. Text extraction (a couple of seconds
 * for a long novel) runs in the background; only handoffs wait for it.
 */
object OpenBooks {
    class OpenBook(val bookId: String, val publication: Publication, val text: Deferred<LoadedBook>)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    var current: OpenBook? = null
        private set

    suspend fun open(context: Context, record: BookRecord): OpenBook {
        current?.takeIf { it.bookId == record.id }?.let { return it }
        current?.let {
            it.text.cancel()
            it.publication.close()
        }
        val publication = withContext(Dispatchers.IO) { LoadedBook.openPublication(context, BookStore.epubFile(record.id)) }
        val text = scope.async { LoadedBook.extract(publication, record.title) }
        return OpenBook(record.id, publication, text).also { current = it }
    }
}
