package feedmebooks.core

import kotlin.test.Test
import kotlin.test.assertEquals

class BookTextTest {
    private val book = BookText.build(
        listOf(
            Section("title.xhtml", listOf("  The   Book ", "")),
            Section("empty.xhtml", emptyList()),
            Section("ch1.xhtml", listOf("It was a bright cold day.", "Winston’s chin was nuzzled — café-au-lait!")),
        ),
    )

    @Test
    fun `normalizes whitespace and skips empty paragraphs`() {
        assertEquals("The Book\nIt was a bright cold day.\nWinston’s chin was nuzzled — café-au-lait!\n", book.text)
        assertEquals(3, book.paragraphs.size)
        assertEquals(1, book.paragraphs[2].paragraphIndex)
    }

    @Test
    fun `tokens are lowercase without diacritics and keep apostrophes`() {
        assertEquals(
            listOf("the", "book", "it", "was", "a", "bright", "cold", "day", "winston's", "chin", "was", "nuzzled", "cafe", "au", "lait"),
            book.words.map { it.norm },
        )
        val w = book.words.first { it.norm == "bright" }
        assertEquals("bright", book.text.substring(w.charStart, w.charEnd))
    }

    @Test
    fun `maps offsets to words, paragraphs and sections`() {
        val offset = book.text.indexOf("cold")
        assertEquals("cold", book.words[book.wordIndexAt(offset)].norm)
        assertEquals("bright", book.words[book.wordIndexAt(book.text.indexOf(" bright"))].norm)
        assertEquals(ParagraphRef(2, 0, 9, 34), book.paragraphAt(offset))
        assertEquals(2, book.progressionOf(offset).first)
    }

    @Test
    fun `progression round-trips within a section`() {
        val offset = book.text.indexOf("chin")
        val (section, progression) = book.progressionOf(offset)
        assertEquals(offset, book.charOffsetOf(section, progression))
    }

    @Test
    fun `resolve refines a coarse position with a snippet`() {
        val target = book.text.indexOf("was nuzzled")
        assertEquals(target, book.resolve(2, 0.0, "was  Nuzzled"))
        assertEquals(book.text.indexOf("was a bright"), book.resolve(2, 0.0, "was"))
        assertEquals(book.charOffsetOf(2, 0.5), book.resolve(2, 0.5, "not in the book"))
    }
}
