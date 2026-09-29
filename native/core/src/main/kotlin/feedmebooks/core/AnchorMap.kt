package feedmebooks.core

/** A confirmed correspondence between a text position and a global audio position. */
data class Anchor(val charOffset: Int, val audioMs: Long)

/**
 * Piecewise-linear mapping between book text and the global audio timeline.
 * The endpoints (0, 0) and (totalChars, totalMs) are implicit. Immutable:
 * [with] returns a new map.
 */
class AnchorMap(
    val totalChars: Int,
    val totalMs: Long,
    anchors: List<Anchor> = emptyList(),
) {
    val anchors: List<Anchor> = anchors.sortedBy { it.charOffset }

    init {
        require(totalChars > 0 && totalMs > 0) { "empty book or audio" }
    }

    private val points: List<Anchor> by lazy {
        buildList {
            add(Anchor(0, 0))
            addAll(this@AnchorMap.anchors)
            add(Anchor(totalChars, totalMs))
        }
    }

    fun textToAudio(charOffset: Int): Long {
        val c = charOffset.coerceIn(0, totalChars)
        val i = points.indexOfLast { it.charOffset <= c }.coerceAtMost(points.size - 2)
        val a = points[i]
        val b = points[i + 1]
        if (b.charOffset == a.charOffset) return a.audioMs
        return a.audioMs + ((c - a.charOffset).toDouble() / (b.charOffset - a.charOffset) * (b.audioMs - a.audioMs)).toLong()
    }

    fun audioToText(audioMs: Long): Int {
        val t = audioMs.coerceIn(0, totalMs)
        val i = points.indexOfLast { it.audioMs <= t }.coerceAtMost(points.size - 2)
        val a = points[i]
        val b = points[i + 1]
        if (b.audioMs == a.audioMs) return a.charOffset
        return a.charOffset + ((t - a.audioMs).toDouble() / (b.audioMs - a.audioMs) * (b.charOffset - a.charOffset)).toInt()
    }

    /**
     * Adds anchors from a fresh match. Newer evidence wins: existing anchors
     * that would make the mapping non-monotonic with the new ones are dropped.
     */
    fun with(vararg added: Anchor): AnchorMap {
        val fresh = added.filter { it.charOffset in 1 until totalChars && it.audioMs in 1 until totalMs }
        if (fresh.isEmpty()) return this
        val kept = anchors.filter { old ->
            fresh.none { new ->
                old.charOffset == new.charOffset ||
                    (old.charOffset < new.charOffset) != (old.audioMs < new.audioMs)
            }
        }
        // The fresh anchors must be monotonic among themselves too; keep the ones that are.
        val merged = ArrayList<Anchor>()
        for (a in (kept + fresh).sortedBy { it.charOffset }) {
            val last = merged.lastOrNull()
            if (last == null || (a.charOffset > last.charOffset && a.audioMs > last.audioMs)) merged += a
        }
        return AnchorMap(totalChars, totalMs, merged)
    }
}
