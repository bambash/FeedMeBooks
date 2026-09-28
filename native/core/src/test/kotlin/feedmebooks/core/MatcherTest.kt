package feedmebooks.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MatcherTest {
    private val sim = Simulation()
    private val book = sim.book

    private fun words(text: String, startMs: Long = 0) =
        text.split(" ").mapIndexed { i, w -> TranscriptWord(w, startMs + i * 400L, startMs + i * 400L + 300) }

    private fun bookSlice(fromWord: Int, count: Int) =
        (fromWord until fromWord + count).joinToString(" ") { book.words[it].norm }

    @Test
    fun `finds an exact excerpt anywhere in the book`() {
        val at = book.words.size * 2 / 3
        val match = assertNotNull(Matcher.align(words(bookSlice(at, 40)), book, 0, book.words.size, 0, 0.4))
        assertEquals(book.words[at].charStart, match.pairs.first().charOffset)
        assertEquals(book.words[at + 39].charStart, match.pairs.last().charOffset)
        assertEquals(1.0, match.confidence)
    }

    @Test
    fun `tolerates dropped, inserted and misspelled words`() {
        val at = 5_000
        val noisy = bookSlice(at, 40).split(" ").toMutableList()
        noisy.removeAt(10)
        noisy.removeAt(20)
        noisy.add(15, "um")
        noisy[25] = noisy[25].let { if (it.length >= 5) it.dropLast(1) + "q" else it }
        val match = assertNotNull(Matcher.align(words(noisy.joinToString(" ")), book, 0, book.words.size, 0, 0.4))
        assertEquals(book.words[at].charStart, match.pairs.first().charOffset)
        assertTrue(match.confidence > 0.8)
    }

    @Test
    fun `breaks ties between repeated passages using the prior`() {
        val refrain = Normalize.words(sim.refrain).map { Normalize.token(it.value) }.toList()
        val occurrences = (0..book.words.size - refrain.size)
            .filter { i -> refrain.indices.all { book.words[i + it].norm == refrain[it] } }
        assertTrue(occurrences.size >= 3, "fixture should repeat the refrain")
        for (occurrence in occurrences) {
            val match = assertNotNull(Matcher.align(words(sim.refrain), book, 0, book.words.size, occurrence + 30, 0.4))
            assertEquals(book.words[occurrence].charStart, match.pairs.first().charOffset)
        }
    }

    @Test
    fun `rejects speech that is not in the book`() {
        val junk = "welcome back to the show today we are talking about gardening tips for the spring season"
        assertNull(Matcher.align(words(junk), book, 0, book.words.size, 0, 0.4))
        assertNull(Matcher.align(emptyList(), book, 0, book.words.size, 0, 0.4))
    }
}
