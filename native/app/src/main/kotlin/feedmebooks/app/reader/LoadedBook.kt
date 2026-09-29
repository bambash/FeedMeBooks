package feedmebooks.app.reader

import android.content.Context
import android.net.Uri
import feedmebooks.core.BookText
import feedmebooks.core.ParagraphRef
import feedmebooks.core.Section
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.publication.Locator
import org.readium.r2.shared.publication.Publication
import org.readium.r2.shared.publication.html.cssSelector
import org.readium.r2.shared.publication.services.content.Content
import org.readium.r2.shared.publication.services.content.content
import org.readium.r2.shared.util.asset.AssetRetriever
import org.readium.r2.shared.util.getOrElse
import org.readium.r2.shared.util.http.DefaultHttpClient
import org.readium.r2.streamer.PublicationOpener
import org.readium.r2.streamer.parser.DefaultPublicationParser
import java.io.File
import kotlin.system.measureTimeMillis

/**
 * An opened EPUB plus its text in [BookText] form. Every paragraph in [text] has the
 * Readium [Locator] of the DOM element it came from, so text positions and reader
 * positions convert exactly in both directions.
 */
class LoadedBook(
    val publication: Publication,
    val title: String,
    val text: BookText,
    private val locators: List<List<Locator>>,
    val extractMs: Long,
) {
    fun locatorOf(paragraph: ParagraphRef): Locator = locators[paragraph.sectionIndex][paragraph.paragraphIndex]

    /** Maps a reader locator (e.g. the first visible element) back to a paragraph. */
    fun paragraphOf(locator: Locator): ParagraphRef? {
        val section = sectionHrefs.indexOf(locator.href.toString())
        if (section < 0) return null
        val selector = locator.locations.cssSelector
        if (selector != null) {
            val index = locators[section].indexOfFirst { it.locations.cssSelector == selector }
            if (index >= 0) return text.paragraphs.firstOrNull { it.sectionIndex == section && it.paragraphIndex == index }
        }
        // No selector match: fall back to finding the locator's text in that section.
        val offset = text.resolve(section, locator.locations.progression ?: 0.0, locator.text.highlight)
        return text.paragraphAt(offset)
    }

    private val sectionHrefs: List<String> = locators.map { it.firstOrNull()?.href?.toString() ?: "" }

    companion object {
        @OptIn(ExperimentalReadiumApi::class)
        suspend fun open(context: Context, uri: Uri, onProgress: (String) -> Unit): LoadedBook {
            onProgress("Copying file…")
            // Readium reads local files most reliably; copy the picked document once.
            val file = File(context.cacheDir, "book.epub")
            context.contentResolver.openInputStream(uri)!!.use { input -> file.outputStream().use { input.copyTo(it) } }

            onProgress("Opening EPUB…")
            val http = DefaultHttpClient()
            val assets = AssetRetriever(context.contentResolver, http)
            val opener = PublicationOpener(DefaultPublicationParser(context, http, assets, pdfFactory = null))
            val asset = assets.retrieve(file).getOrElse { error("Can't read file: ${it.message}") }
            val publication = opener.open(asset, allowUserInteraction = false)
                .getOrElse { error("Can't open EPUB: ${it.message}") }

            val sections = ArrayList<Section>()
            val locators = ArrayList<List<Locator>>()
            val extractMs = measureTimeMillis {
                val content = publication.content() ?: error("No text content in this EPUB")
                val byHref = LinkedHashMap<String, Pair<MutableList<String>, MutableList<Locator>>>()
                var count = 0
                val iterator = content.iterator()
                while (iterator.hasNext()) {
                    val element = iterator.next() as? Content.TextElement ?: continue
                    val paragraph = element.text.trim()
                    if (paragraph.isBlank()) continue
                    val (texts, locs) = byHref.getOrPut(element.locator.href.toString()) { mutableListOf<String>() to mutableListOf() }
                    texts += paragraph
                    locs += element.locator
                    if (++count % 500 == 0) onProgress("Extracting text… $count paragraphs")
                }
                for ((href, value) in byHref) {
                    sections += Section(href, value.first)
                    locators += value.second
                }
            }
            val title = publication.metadata.title ?: file.name
            return LoadedBook(publication, title, BookText.build(sections), locators, extractMs)
        }
    }
}

/** Hand-off between the launcher and the reader activity (a spike; no persistence yet). */
object SpikeState {
    var book: LoadedBook? = null
}
