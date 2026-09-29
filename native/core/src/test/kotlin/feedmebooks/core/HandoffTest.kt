package feedmebooks.core

import kotlin.math.abs
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HandoffTest {
    private val sim = Simulation()
    private val book = sim.book

    /** Playhead times spread across the narrated book (skipping the intro). */
    private val times = Random(1).let { r -> List(40) { r.nextLong(sim.introMs + 25_000, sim.totalMs - 10_000) } }

    /** Paragraph starts spread across the book, as if the reader stopped at the top of a page. */
    private val offsets = Random(2).let { r ->
        List(40) { book.paragraphs[r.nextInt(1, book.paragraphs.size)].charStart }
            .filter { book.paragraphAt(it) != sim.skippedParagraph }
    }

    @Test
    fun `audio to text lands within a few words with no prior anchors`() {
        val handoff = Handoff(book, sim.transcriber())
        for (t in times) {
            val target = handoff.audioToText(t, sim.freshAnchors())
            val truth = sim.truthCharAt(t)
            assertTrue(target.confident, "no match at ${t}ms")
            assertTrue(abs(target.charOffset - truth) <= 60, "at ${t}ms: got ${target.charOffset}, truth $truth")
            assertEquals(book.paragraphAt(truth), target.paragraph)
        }
    }

    @Test
    fun `text to audio lands within a second or two with no prior anchors`() {
        val transcriber = sim.transcriber()
        val handoff = Handoff(book, transcriber)
        for (c in offsets) {
            val target = handoff.textToAudio(c, sim.freshAnchors())
            val truth = sim.truthAudioAt(c)
            assertTrue(target.confident, "no match for char $c after ${target.probes} probes")
            assertTrue(abs(target.audioMs - truth) <= 1_500, "char $c: got ${target.audioMs}ms, truth ${truth}ms")
        }
        assertTrue(transcriber.calls <= offsets.size * 3)
    }

    @Test
    fun `learned anchors make later switches cheaper`() {
        val transcriber = sim.transcriber()
        val handoff = Handoff(book, transcriber)
        var anchors = sim.freshAnchors()
        // A realistic session: alternate listening and reading, persisting anchors each time.
        for (t in times.take(20)) anchors = handoff.audioToText(t, anchors).anchors
        assertTrue(anchors.anchors.size >= 20)

        val coldProbes = offsets.sumOf { handoff.textToAudio(it, sim.freshAnchors()).probes }
        val warmProbes = offsets.sumOf { handoff.textToAudio(it, anchors).probes }
        println("text→audio probes over ${offsets.size} switches: cold $coldProbes, warm $warmProbes")
        assertTrue(warmProbes < coldProbes, "warm $warmProbes vs cold $coldProbes")
    }

    @Test
    fun `switching back after a handoff resolves in one probe`() {
        val handoff = Handoff(book, sim.transcriber())
        for (t in times) {
            val read = handoff.audioToText(t, sim.freshAnchors())
            // Reader glanced at the page and went straight back to listening.
            val listen = handoff.textToAudio(read.charOffset, read.anchors)
            assertEquals(1, listen.probes)
            assertTrue(abs(listen.audioMs - t) <= 3_000, "left audio at ${t}ms, came back at ${listen.audioMs}ms")
        }
    }

    @Test
    fun `works through heavy recognition noise`() {
        val handoff = Handoff(book, sim.transcriber(dropRate = 0.2, misspellRate = 0.25, insertRate = 0.1))
        val misses = times.count { t ->
            val target = handoff.audioToText(t, sim.freshAnchors())
            abs(target.charOffset - sim.truthCharAt(t)) > 150
        }
        assertTrue(misses <= 1, "$misses of ${times.size} switches missed")
    }

    @Test
    fun `silence or unrecognisable audio falls back to an unconfident estimate`() {
        val silent = Handoff(book, Transcriber { _, _ -> emptyList() })
        val anchors = sim.freshAnchors()
        val t = sim.totalMs / 2
        val text = silent.audioToText(t, anchors)
        assertFalse(text.confident)
        assertEquals(anchors.audioToText(t), text.charOffset)

        val audio = silent.textToAudio(book.length / 2, anchors)
        assertFalse(audio.confident)
        assertEquals(anchors.textToAudio(book.length / 2), audio.audioMs)
    }

    @Test
    fun `handles the narrator's intro before any book text`() {
        val handoff = Handoff(book, sim.transcriber())
        val firstWord = book.paragraphs[0].charStart
        val target = handoff.textToAudio(firstWord, sim.freshAnchors())
        assertTrue(target.confident)
        assertTrue(abs(target.audioMs - sim.introMs) <= 1_500, "got ${target.audioMs}, intro ends ${sim.introMs}")
    }
}
