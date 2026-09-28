package feedmebooks.core

import kotlin.test.Test
import kotlin.test.assertEquals

class AnchorMapTest {
    @Test
    fun `without anchors the mapping is proportional`() {
        val map = AnchorMap(1_000, 100_000)
        assertEquals(50_000, map.textToAudio(500))
        assertEquals(250, map.audioToText(25_000))
        assertEquals(100_000, map.textToAudio(5_000))
        assertEquals(0, map.audioToText(-10))
    }

    @Test
    fun `interpolates between anchors in both directions`() {
        val map = AnchorMap(1_000, 100_000).with(Anchor(100, 30_000), Anchor(600, 60_000))
        assertEquals(15_000, map.textToAudio(50))
        assertEquals(45_000, map.textToAudio(350))
        assertEquals(350, map.audioToText(45_000))
        assertEquals(800, map.audioToText(80_000))
    }

    @Test
    fun `newer anchors replace conflicting ones`() {
        val map = AnchorMap(1_000, 100_000)
            .with(Anchor(200, 20_000), Anchor(500, 50_000))
            .with(Anchor(300, 60_000))
        // (500, 50s) is now out of order relative to (300, 60s) and is dropped.
        assertEquals(listOf(Anchor(200, 20_000), Anchor(300, 60_000)), map.anchors)
    }

    @Test
    fun `ignores anchors at or outside the endpoints`() {
        val map = AnchorMap(1_000, 100_000).with(Anchor(0, 0), Anchor(1_000, 100_000), Anchor(500, 200_000))
        assertEquals(emptyList(), map.anchors)
    }
}
