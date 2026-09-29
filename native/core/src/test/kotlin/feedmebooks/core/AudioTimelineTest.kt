package feedmebooks.core

import kotlin.test.Test
import kotlin.test.assertEquals

class AudioTimelineTest {
    // Three files: 10 min, 25 min, 5 min.
    private val timeline = AudioTimeline(listOf(600_000, 1_500_000, 300_000))

    @Test
    fun `maps global time to file and offset`() {
        assertEquals(2_400_000, timeline.totalMs)
        assertEquals(TrackPosition(0, 0), timeline.locate(0))
        assertEquals(TrackPosition(0, 599_999), timeline.locate(599_999))
        assertEquals(TrackPosition(1, 0), timeline.locate(600_000))
        assertEquals(TrackPosition(1, 900_000), timeline.locate(1_500_000))
        assertEquals(TrackPosition(2, 299_000), timeline.locate(2_399_000))
    }

    @Test
    fun `clamps out-of-range times`() {
        assertEquals(TrackPosition(0, 0), timeline.locate(-5))
        assertEquals(TrackPosition(2, 300_000), timeline.locate(9_999_999))
    }

    @Test
    fun `round-trips file positions`() {
        for (t in listOf(0L, 1L, 599_999L, 600_000L, 1_234_567L, 2_100_000L, 2_399_999L)) {
            assertEquals(t, timeline.globalMs(timeline.locate(t)))
        }
    }

    @Test
    fun `splits a window that spans a file boundary`() {
        // 20 s window centred on the end of file 1.
        assertEquals(
            listOf(TrackSlice(0, 590_000, 600_000), TrackSlice(1, 0, 10_000)),
            timeline.slices(590_000, 610_000),
        )
        assertEquals(listOf(TrackSlice(1, 100_000, 120_000)), timeline.slices(700_000, 720_000))
        assertEquals(listOf(TrackSlice(2, 290_000, 300_000)), timeline.slices(2_390_000, 2_500_000))
    }

    @Test
    fun `skips empty files`() {
        val withEmpty = AudioTimeline(listOf(1_000, 0, 2_000))
        assertEquals(TrackPosition(2, 0), withEmpty.locate(1_000))
        assertEquals(listOf(TrackSlice(0, 500, 1_000), TrackSlice(2, 0, 500)), withEmpty.slices(500, 1_500))
    }

    @Test
    fun `natural order sorts numbered files the way people expect`() {
        val names = listOf("Part 10.mp4", "part 2.mp4", "Part 1.mp4", "Part 02b.mp4", "Intro.mp4", "Part 001.mp4")
        assertEquals(
            listOf("Intro.mp4", "Part 1.mp4", "Part 001.mp4", "part 2.mp4", "Part 02b.mp4", "Part 10.mp4"),
            names.sortedWith(NaturalOrder),
        )
        assertEquals(
            listOf("Book - 01 - Opening.mp4", "Book - 02 - Arrival.mp4", "Book - 11 - End.mp4"),
            listOf("Book - 11 - End.mp4", "Book - 01 - Opening.mp4", "Book - 02 - Arrival.mp4").sortedWith(NaturalOrder),
        )
    }
}
