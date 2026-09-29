package feedmebooks.core

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.min

/** A word from speech recognition, timed on the global audio timeline. */
data class TranscriptWord(val text: String, val startMs: Long, val endMs: Long)

/** A transcript token aligned to a book word. */
data class AlignedPair(val charOffset: Int, val audioMs: Long, val exact: Boolean)

data class Match(
    /** Aligned pairs in reading order. */
    val pairs: List<AlignedPair>,
    val score: Int,
    /** (exact + 0.5 × similar) / transcript tokens, in 0–1. */
    val confidence: Double,
)

/**
 * Locates a short transcript inside a range of book words with token-level
 * Smith–Waterman local alignment, which tolerates dropped, inserted and
 * misrecognised words. Cost is O(transcript tokens × range words).
 */
object Matcher {
    private const val EXACT = 3
    private const val SIMILAR = 1
    private const val MISMATCH = -2
    private const val GAP = -1

    /** Near-best alternatives within this share of the top score are tie-broken by distance to the prior. */
    private const val TIE_TOLERANCE = 0.9

    private class Token(val norm: String, val startMs: Long)

    /**
     * Aligns [transcript] against book words `[fromWord, toWord)`. When several
     * places score about equally (repeated phrases), picks the one nearest
     * [priorWord]. Returns null if nothing clears [minConfidence].
     */
    fun align(
        transcript: List<TranscriptWord>,
        book: BookText,
        fromWord: Int,
        toWord: Int,
        priorWord: Int,
        minConfidence: Double,
    ): Match? {
        val tokens = tokenize(transcript)
        val n = tokens.size
        val lo = fromWord.coerceIn(0, book.words.size)
        val hi = toWord.coerceIn(lo, book.words.size)
        val m = hi - lo
        if (n == 0 || m == 0) return null

        // Intern the range's vocabulary so the inner loop is an array lookup.
        val vocab = HashMap<String, Int>()
        val vocabList = ArrayList<String>()
        val bookIds = IntArray(m) { j ->
            val w = book.words[lo + j].norm
            vocab.getOrPut(w) { vocabList.add(w); vocabList.size - 1 }
        }
        val scores = Array(n) { i -> ByteArray(vocabList.size) { v -> score(tokens[i].norm, vocabList[v]).toByte() } }

        val width = m + 1
        val dir = ByteArray((n + 1) * width) // 0 stop, 1 diagonal, 2 up, 3 left
        var prev = IntArray(width)
        var cur = IntArray(width)
        val colBest = IntArray(width)
        val colArg = IntArray(width)
        for (i in 1..n) {
            cur[0] = 0
            val row = scores[i - 1]
            for (j in 1..m) {
                val d = prev[j - 1] + row[bookIds[j - 1]]
                val u = prev[j] + GAP
                val l = cur[j - 1] + GAP
                var h = 0
                var dr: Byte = 0
                if (d > h) { h = d; dr = 1 }
                if (u > h) { h = u; dr = 2 }
                if (l > h) { h = l; dr = 3 }
                cur[j] = h
                dir[i * width + j] = dr
                if (h > colBest[j]) { colBest[j] = h; colArg[j] = i }
            }
            val t = prev; prev = cur; cur = t
        }

        val best = colBest.max()
        if (best <= 0) return null

        // Group near-best end columns into clusters (one per candidate location),
        // take each cluster's peak, and prefer the peak nearest the prior.
        val threshold = ceil(best * TIE_TOLERANCE).toInt()
        var endJ = -1
        var clusterPeak = -1
        var lastJ = Int.MIN_VALUE
        fun offerPeak(j: Int) {
            if (endJ < 0 || abs(lo + j - 1 - priorWord) < abs(lo + endJ - 1 - priorWord)) endJ = j
        }
        for (j in 1..m) {
            if (colBest[j] < threshold) continue
            if (j - lastJ > n && clusterPeak >= 0) { offerPeak(clusterPeak); clusterPeak = -1 }
            if (clusterPeak < 0 || colBest[j] > colBest[clusterPeak]) clusterPeak = j
            lastJ = j
        }
        if (clusterPeak >= 0) offerPeak(clusterPeak)

        val pairs = ArrayList<AlignedPair>()
        var exact = 0
        var similar = 0
        var i = colArg[endJ]
        var j = endJ
        while (i > 0 && j > 0) {
            when (dir[i * width + j].toInt()) {
                0 -> break
                1 -> {
                    val s = scores[i - 1][bookIds[j - 1]]
                    if (s > 0) {
                        val isExact = s.toInt() == EXACT
                        if (isExact) exact++ else similar++
                        pairs += AlignedPair(book.words[lo + j - 1].charStart, tokens[i - 1].startMs, isExact)
                    }
                    i--; j--
                }
                2 -> i--
                else -> j--
            }
        }
        pairs.reverse()
        val confidence = (exact + 0.5 * similar) / n
        if (pairs.size < 3 || confidence < minConfidence) return null
        return Match(pairs, colBest[endJ], confidence)
    }

    private fun tokenize(transcript: List<TranscriptWord>): List<Token> = buildList {
        for (w in transcript) {
            val parts = Normalize.words(w.text).map { Normalize.token(it.value) }.toList()
            // A recognised "word" can hold several tokens ("well-known"); spread its time across them.
            parts.forEachIndexed { k, p ->
                add(Token(p, w.startMs + (w.endMs - w.startMs) * k / parts.size))
            }
        }
    }

    private fun score(a: String, b: String): Int = when {
        a == b -> EXACT
        similar(a, b) -> SIMILAR
        else -> MISMATCH
    }

    /** Small edit distance on longer words: catches recognition misspellings, not different words. */
    private fun similar(a: String, b: String): Boolean {
        val shorter = min(a.length, b.length)
        if (shorter < 4) return false
        val maxDist = if (shorter >= 7) 2 else 1
        if (abs(a.length - b.length) > maxDist) return false
        var prev = IntArray(b.length + 1) { it }
        var cur = IntArray(b.length + 1)
        for (x in 1..a.length) {
            cur[0] = x
            var rowMin = cur[0]
            for (y in 1..b.length) {
                cur[y] = minOf(prev[y] + 1, cur[y - 1] + 1, prev[y - 1] + if (a[x - 1] == b[y - 1]) 0 else 1)
                if (cur[y] < rowMin) rowMin = cur[y]
            }
            if (rowMin > maxDist) return false
            val t = prev; prev = cur; cur = t
        }
        return prev[b.length] <= maxDist
    }
}
