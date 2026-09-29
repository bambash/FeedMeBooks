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

    /** The paragraph's opening text without whitespace, as the page probe compares it. */
    fun compactPrefix(paragraph: ParagraphRef, length: Int = PREFIX_LENGTH): String =
        PageProbe.compact(text.text.substring(paragraph.charStart, paragraph.charEnd)).take(length)

    /**
     * Maps what the page probe saw to a paragraph. Repeated short paragraphs ("Yes.") are
     * disambiguated by their relative position within the resource.
     */
    fun paragraphMatching(href: String, visible: PageProbe.Visible): ParagraphRef? {
        val section = sectionHrefs.indexOf(href)
        if (section < 0) return null
        val inSection = text.paragraphs.filter { it.sectionIndex == section }
        val key = visible.compactText.take(PREFIX_LENGTH)
        val relative = visible.ordinal.toDouble() / visible.total.coerceAtLeast(1)
        return inSection.withIndex()
            .filter { (_, p) -> compactPrefix(p).let { c -> c.startsWith(key) || key.startsWith(c) } }
            .minByOrNull { (i, _) -> kotlin.math.abs(i.toDouble() / inSection.size - relative) }
            ?.value
    }

    private fun paragraphText(p: ParagraphRef) = text.text.substring(p.charStart, p.charEnd)

    /** Book offset of the [compactOffset]-th visible character of [paragraph] (see [PageProbe]). */
    fun charOffsetOf(paragraph: ParagraphRef, compactOffset: Int): Int =
        paragraph.charStart + PageProbe.rawIndex(paragraphText(paragraph), compactOffset).coerceAtMost(paragraph.charEnd - paragraph.charStart - 1)

    /** Inverse of [charOffsetOf]: compact position of [charOffset] inside its paragraph. */
    fun compactOffsetOf(charOffset: Int): Int {
        val p = text.paragraphAt(charOffset)
        return PageProbe.compactIndex(paragraphText(p), charOffset - p.charStart)
    }

    /**
     * A locator for just the sentence containing [charOffset]: the paragraph's locator
     * (resource + CSS selector) narrowed by a text quote, so Readium can highlight it.
     */
    fun sentenceLocator(charOffset: Int): Locator {
        val p = text.paragraphAt(charOffset)
        val sentence = text.sentenceAt(charOffset)
        val quote = Locator.Text(
            before = text.text.substring(maxOf(p.charStart, sentence.first - QUOTE_CONTEXT), sentence.first),
            highlight = text.text.substring(sentence.first, sentence.last + 1),
            after = text.text.substring(sentence.last + 1, minOf(p.charEnd, sentence.last + 1 + QUOTE_CONTEXT)),
        )
        return locatorOf(p).copy(text = quote)
    }

    companion object {
        private const val PREFIX_LENGTH = 40
        private const val QUOTE_CONTEXT = 50

        suspend fun openPublication(context: Context, file: File): Publication {
            val http = DefaultHttpClient()
            val assets = AssetRetriever(context.contentResolver, http)
            val opener = PublicationOpener(DefaultPublicationParser(context, http, assets, pdfFactory = null))
            val asset = assets.retrieve(file).getOrElse { error("Can't read file: ${it.message}") }
            return opener.open(asset, allowUserInteraction = false)
                .getOrElse { error("Can't open EPUB: ${it.message}") }
        }

        /** Lab entry point: copies a picked document and loads it fully. */
        suspend fun open(context: Context, uri: Uri, onProgress: (String) -> Unit): LoadedBook {
            onProgress("Copying file…")
            // Readium reads local files most reliably; copy the picked document once.
            val file = File(context.cacheDir, "book.epub")
            context.contentResolver.openInputStream(uri)!!.use { input -> file.outputStream().use { input.copyTo(it) } }
            onProgress("Opening EPUB…")
            val publication = openPublication(context, file)
            return extract(publication, publication.metadata.title ?: file.name, onProgress)
        }

        /** Walks the publication's content once, pairing each paragraph with its locator. A few seconds for a long novel. */
        @OptIn(ExperimentalReadiumApi::class)
        suspend fun extract(publication: Publication, title: String, onProgress: (String) -> Unit = {}): LoadedBook {
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
            return LoadedBook(publication, title, BookText.build(sections), locators, extractMs)
        }
    }
}
