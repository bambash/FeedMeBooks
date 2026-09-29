package feedmebooks.core

import kotlin.random.Random

/**
 * A synthetic audiobook with known ground truth: a generated book, a narration
 * timeline (with an intro that isn't in the text and a skipped paragraph), and
 * a noisy fake Whisper over it.
 */
class Simulation(seed: Int = 42, sectionCount: Int = 12) {
    private val rng = Random(seed)

    private val common = listOf("the", "and", "of", "a", "to", "in", "he", "she", "was", "it", "said", "that", "his", "her")
    private val syllables = listOf("ka", "ro", "mi", "ten", "sul", "ve", "dra", "nor", "pel", "ith", "gar", "lo", "fen", "sa", "bri", "tor", "wen", "ul")
    private val vocab = List(3000) { List(rng.nextInt(1, 4)) { syllables.random(rng) }.joinToString("") }.distinct()

    /** A phrase repeated verbatim in several chapters, to test tie-breaking by prior. */
    val refrain = "the bells of garloth rang over the silent harbour and nobody in the town could say why"

    private fun word() = if (rng.nextDouble() < 0.35) common.random(rng) else vocab.random(rng)

    val sections: List<Section> = List(sectionCount) { s ->
        Section(
            href = "ch$s.xhtml",
            paragraphs = buildList {
                add("Chapter ${s + 1}")
                repeat(rng.nextInt(20, 40)) { p ->
                    val words = List(rng.nextInt(40, 120)) { word() }
                    val text = words.joinToString(" ").replaceFirstChar { it.uppercase() } + "."
                    add(if (p == 5 && s % 3 == 0) "$refrain. $text" else text)
                }
            },
        )
    }

    val book: BookText = BookText.build(sections)

    /** Book word index → narrated start/end ms, or null if the narrator skipped it. */
    private val wordStart = LongArray(book.words.size) { -1 }
    private val wordEnd = LongArray(book.words.size) { -1 }

    /** Everything spoken, in order: book words plus the intro that isn't in the book. */
    private val spoken = ArrayList<TranscriptWord>()

    val introMs: Long
    val totalMs: Long
    val skippedParagraph: ParagraphRef = book.paragraphs[book.paragraphs.size / 2]

    init {
        var t = 0L
        for (w in "this is a recording of the complete unabridged audiobook read for you by a narrator with a warm voice recorded in a quiet studio".split(" ")) {
            val d = 150L + 50L * w.length
            spoken += TranscriptWord(w, t, t + d)
            t += d + 80
        }
        t += 3_000
        introMs = t
        var lastParagraph: ParagraphRef? = null
        book.words.forEachIndexed { i, w ->
            val para = book.paragraphAt(w.charStart)
            if (para == skippedParagraph) return@forEachIndexed // e.g. a footnote the narrator doesn't read
            if (para != lastParagraph && lastParagraph != null) {
                t += if (para.sectionIndex != lastParagraph!!.sectionIndex) 2_500 else 700
            }
            lastParagraph = para
            // Narration speed drifts through the book, so linear estimates go wrong.
            val pace = 1.0 + 0.25 * kotlin.math.sin(i / 2000.0)
            val d = ((110 + 55 * w.norm.length) * pace * (0.85 + rng.nextDouble() * 0.3)).toLong()
            wordStart[i] = t
            wordEnd[i] = t + d
            spoken += TranscriptWord(book.text.substring(w.charStart, w.charEnd), t, t + d)
            t += d + 60
        }
        totalMs = t + 5_000
    }

    fun freshAnchors() = AnchorMap(book.length, totalMs)

    /** Ground truth: char offset of the word being spoken at (or last spoken before) [audioMs]. */
    fun truthCharAt(audioMs: Long): Int {
        var best = 0
        for (i in book.words.indices) {
            if (wordStart[i] in 0..audioMs) best = book.words[i].charStart
        }
        return best
    }

    /** Ground truth: when the word containing [charOffset] starts being spoken. */
    fun truthAudioAt(charOffset: Int): Long {
        var i = book.wordIndexAt(charOffset)
        while (wordStart[i] < 0) i++
        return wordStart[i]
    }

    /**
     * Fake Whisper: returns spoken words in the window with dropped words,
     * misspellings, junk insertions, casing and punctuation noise.
     */
    fun transcriber(
        seed: Int = 7,
        dropRate: Double = 0.08,
        misspellRate: Double = 0.08,
        insertRate: Double = 0.03,
    ) = CountingTranscriber { startMs, endMs ->
        val r = Random(seed + startMs.toInt())
        buildList {
            for (w in spoken) {
                if (w.startMs < startMs || w.endMs > endMs) continue
                if (r.nextDouble() < insertRate) add(TranscriptWord("um", w.startMs, w.startMs))
                if (r.nextDouble() < dropRate) continue
                var text = w.text
                if (r.nextDouble() < misspellRate && text.length >= 5) {
                    val k = r.nextInt(1, text.length - 1)
                    text = text.substring(0, k) + "x" + text.substring(k + 1)
                }
                if (r.nextDouble() < 0.1) text = "$text,"
                add(TranscriptWord(text, w.startMs, w.endMs))
            }
        }
    }
}

class CountingTranscriber(private val inner: Transcriber) : Transcriber {
    var calls = 0
        private set

    override fun transcribe(startMs: Long, endMs: Long): List<TranscriptWord> {
        calls++
        return inner.transcribe(startMs, endMs)
    }
}
