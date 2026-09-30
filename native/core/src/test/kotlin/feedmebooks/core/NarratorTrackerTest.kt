package feedmebooks.core

import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NarratorTrackerTest {
    private val sim = Simulation()
    private val book = sim.book

    /** Plays [durationMs] of audio from [startMs] in half-second ticks, probing when the tracker asks. */
    private fun follow(startMs: Long, durationMs: Long, tracker: NarratorTracker, transcriber: CountingTranscriber): List<Pair<Long, Int>> {
        val handoff = Handoff(book, transcriber)
        var anchors = sim.freshAnchors()
        val estimates = ArrayList<Pair<Long, Int>>()
        var t = startMs
        while (t < startMs + durationMs) {
            if (tracker.needsProbe(t)) {
                val target = handoff.audioToText(t, anchors)
                anchors = target.anchors
                tracker.fixed(target)
            }
            estimates += t to tracker.estimate(t)!!
            t += 500
        }
        return estimates
    }

    @Test
    fun `follows the narrator to within a sentence between probes`() {
        val transcriber = sim.transcriber()
        val tracker = NarratorTracker()
        val estimates = follow(sim.introMs + 60_000, 5 * 60_000, tracker, transcriber)
        val errors = estimates.map { (t, c) -> abs(c - sim.truthCharAt(t)) }
        val within = errors.count { it <= 200 }
        println("read-along: ${transcriber.calls} probes over 5 min, ${within}/${errors.size} ticks within 200 chars, worst ${errors.max()}")
        assertTrue(within >= errors.size * 0.97, "only $within of ${errors.size} ticks were close")
        // One probe per interval, plus the first one: no busy re-probing.
        assertTrue(transcriber.calls <= 5 * 60_000 / 30_000 + 2, "${transcriber.calls} probes")
    }

    @Test
    fun `a fix is carried forward at the narration rate`() {
        val handoff = Handoff(book, sim.transcriber())
        val t = sim.introMs + 120_000
        val target = handoff.audioToText(t, sim.freshAnchors())
        assertTrue(target.confident)
        assertEquals(t, target.audioMs)
        for (ahead in listOf(2_000L, 10_000L, 25_000L)) {
            val truth = sim.truthCharAt(t + ahead)
            assertTrue(abs(target.at(t + ahead) - truth) <= 200, "${ahead}ms ahead: got ${target.at(t + ahead)}, truth $truth")
        }
    }

    @Test
    fun `probes again after the interval, after a rewind, and sooner after a miss`() {
        val tracker = NarratorTracker(TrackerConfig(probeIntervalMs = 30_000, retryIntervalMs = 8_000))
        assertTrue(tracker.needsProbe(0))
        assertNull(tracker.estimate(0))
        val anchors = sim.freshAnchors()
        val paragraph = book.paragraphs[3]
        tracker.fixed(TextTarget(paragraph.charStart, paragraph, confident = true, anchors, audioMs = 100_000, charsPerMs = 0.02))
        assertFalse(tracker.needsProbe(100_000))
        assertFalse(tracker.needsProbe(129_000))
        assertTrue(tracker.needsProbe(131_000))
        assertTrue(tracker.needsProbe(90_000), "seeking back should re-probe")
        assertEquals(paragraph.charStart + 200, tracker.estimate(110_000))

        tracker.fixed(TextTarget(paragraph.charStart, paragraph, confident = false, anchors, audioMs = 200_000, charsPerMs = 0.02))
        assertFalse(tracker.needsProbe(205_000))
        assertTrue(tracker.needsProbe(209_000), "an unconfident fix should retry sooner")

        tracker.reset()
        assertTrue(tracker.needsProbe(205_000))
    }

    @Test
    fun `a probe that fails is not retried before the retry interval`() {
        val tracker = NarratorTracker(TrackerConfig(retryIntervalMs = 8_000))
        assertTrue(tracker.needsProbe(50_000))
        tracker.failed(50_000)
        assertFalse(tracker.needsProbe(50_500))
        assertFalse(tracker.needsProbe(57_000))
        assertTrue(tracker.needsProbe(58_500))
        // A later success clears the hold and the fix is used as usual.
        val paragraph = book.paragraphs[3]
        tracker.fixed(TextTarget(paragraph.charStart, paragraph, confident = true, sim.freshAnchors(), audioMs = 60_000, charsPerMs = 0.02))
        assertFalse(tracker.needsProbe(61_000))
        assertEquals(paragraph.charStart + 20, tracker.estimate(61_000))
    }
}
