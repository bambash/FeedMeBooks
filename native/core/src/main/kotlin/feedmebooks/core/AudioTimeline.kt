package feedmebooks.core

/** A position inside one file of a multi-file audiobook. */
data class TrackPosition(val track: Int, val offsetMs: Long)

/** The part of one file covered by a global time range. */
data class TrackSlice(val track: Int, val fromMs: Long, val toMs: Long)

/**
 * Concatenates an audiobook's files into one global timeline, so everything above
 * this (anchors, handoff) works in a single `audioMs` and never cares how the
 * publisher split the book into files.
 */
class AudioTimeline(durationsMs: List<Long>) {
    val durationsMs: List<Long> = durationsMs.toList()

    /** Global start of each track. */
    private val starts: LongArray = LongArray(durationsMs.size).also { starts ->
        var acc = 0L
        durationsMs.forEachIndexed { i, d ->
            require(d >= 0) { "negative duration for track $i" }
            starts[i] = acc
            acc += d
        }
    }

    val totalMs: Long = durationsMs.sum()
    val trackCount: Int get() = durationsMs.size

    fun startOf(track: Int): Long = starts[track]

    fun globalMs(position: TrackPosition): Long = starts[position.track] + position.offsetMs

    /** The track playing at [globalMs]. A time exactly on a boundary belongs to the next track. */
    fun locate(globalMs: Long): TrackPosition {
        require(durationsMs.isNotEmpty()) { "no tracks" }
        val t = globalMs.coerceIn(0, totalMs)
        var track = durationsMs.indices.last { starts[it] <= t && (durationsMs[it] > 0 || it == durationsMs.lastIndex) }
        // Past the end of the last track: clamp to its end.
        if (t >= totalMs) track = durationsMs.indices.last { durationsMs[it] > 0 }
        return TrackPosition(track, t - starts[track])
    }

    /** Splits `[fromMs, toMs)` into per-file pieces, in order, for decoding across file boundaries. */
    fun slices(fromMs: Long, toMs: Long): List<TrackSlice> {
        val from = fromMs.coerceIn(0, totalMs)
        val to = toMs.coerceIn(from, totalMs)
        return durationsMs.indices.mapNotNull { i ->
            val start = maxOf(from, starts[i])
            val end = minOf(to, starts[i] + durationsMs[i])
            if (end > start) TrackSlice(i, start - starts[i], end - starts[i]) else null
        }
    }
}

/**
 * Orders file names the way people number them: "Part 2" before "Part 10",
 * "01 - Intro" before "02 - Chapter One". Case-insensitive.
 */
object NaturalOrder : Comparator<String> {
    private val CHUNK = Regex("\\d+|\\D+")

    override fun compare(a: String, b: String): Int {
        val x = CHUNK.findAll(a.lowercase()).map { it.value }.toList()
        val y = CHUNK.findAll(b.lowercase()).map { it.value }.toList()
        for (i in 0 until minOf(x.size, y.size)) {
            val p = x[i]
            val q = y[i]
            val c = if (p[0].isDigit() && q[0].isDigit()) {
                val byValue = p.trimStart('0').length.compareTo(q.trimStart('0').length)
                    .takeIf { it != 0 } ?: p.trimStart('0').compareTo(q.trimStart('0'))
                byValue.takeIf { it != 0 } ?: p.length.compareTo(q.length)
            } else {
                p.compareTo(q)
            }
            if (c != 0) return c
        }
        return x.size.compareTo(y.size)
    }
}
