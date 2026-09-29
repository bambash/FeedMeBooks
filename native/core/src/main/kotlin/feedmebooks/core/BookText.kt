package feedmebooks.core

import java.text.Normalizer

/** One EPUB spine item, already reduced to its block-level paragraphs (plain text). */
data class Section(val href: String, val paragraphs: List<String>)

/** A normalized word token and where it sits in [BookText.text]. */
data class Word(val norm: String, val charStart: Int, val charEnd: Int)

/**
 * A non-empty paragraph. [paragraphIndex] is the index into the original
 * [Section.paragraphs] list, so the app can map it back to a DOM block.
 */
data class ParagraphRef(
    val sectionIndex: Int,
    val paragraphIndex: Int,
    val charStart: Int,
    val charEnd: Int,
)

private const val TERMINATORS = ".!?…"
private const val CLOSERS = "\"'”’)]"
private const val OPENERS = "\"'“‘(["

object Normalize {
    private val WHITESPACE = Regex("\\s+")
    private val WORD = Regex("[\\p{L}\\p{N}]+(?:['’][\\p{L}\\p{N}]+)*")
    private val MARKS = Regex("\\p{Mn}+")

    fun paragraph(raw: String): String =
        WHITESPACE.replace(Normalizer.normalize(raw, Normalizer.Form.NFC), " ").trim()

    /** Lowercase, strip diacritics, unify apostrophes. Applied identically to book and transcript. */
    fun token(raw: String): String =
        MARKS.replace(Normalizer.normalize(raw, Normalizer.Form.NFD), "")
            .lowercase()
            .replace('’', '\'')

    fun words(text: String): Sequence<MatchResult> = WORD.findAll(text)
}

/**
 * The whole book as one normalized string. A text position anywhere in the app
 * is a `charOffset` into [text]; this class converts between that and
 * words, paragraphs, and (section, progression) pairs used by the reader.
 */
class BookText private constructor(
    val text: String,
    val words: List<Word>,
    val paragraphs: List<ParagraphRef>,
    private val sectionStarts: IntArray,
) {
    val length: Int get() = text.length
    val sectionCount: Int get() = sectionStarts.size

    /** Index of the word containing [charOffset], or the next word after it. */
    fun wordIndexAt(charOffset: Int): Int {
        if (words.isEmpty()) return 0
        var lo = 0
        var hi = words.size - 1
        while (lo < hi) {
            val mid = (lo + hi) ushr 1
            if (words[mid].charEnd <= charOffset) lo = mid + 1 else hi = mid
        }
        return lo
    }

    fun paragraphAt(charOffset: Int): ParagraphRef {
        require(paragraphs.isNotEmpty()) { "book has no text" }
        var lo = 0
        var hi = paragraphs.size - 1
        while (lo < hi) {
            val mid = (lo + hi + 1) ushr 1
            if (paragraphs[mid].charStart <= charOffset) lo = mid else hi = mid - 1
        }
        return paragraphs[lo]
    }

    /**
     * The sentence containing [charOffset], clamped to its paragraph. Used to highlight
     * exactly where a handoff resumes. Handles closing quotes after the terminator
     * ("Stop!" she said.) and ellipses written as ". . ." or "…".
     */
    fun sentenceAt(charOffset: Int): IntRange {
        val para = paragraphAt(charOffset)
        val at = charOffset.coerceIn(para.charStart, (para.charEnd - 1).coerceAtLeast(para.charStart))
        var start = para.charStart
        for (i in at - 1 downTo para.charStart) {
            if (isSentenceBreak(i, para.charEnd)) {
                start = i + 1
                break
            }
        }
        while (start < at && text[start] == ' ') start++
        var end = para.charEnd
        for (i in at until para.charEnd) {
            if (isSentenceBreak(i, para.charEnd)) {
                end = i // the break is the space after the terminator
                break
            }
        }
        return start until end
    }

    /** True if position [i] ends a sentence: a terminator (plus closing quotes) followed by a space and a capital or quote. */
    private fun isSentenceBreak(i: Int, limit: Int): Boolean {
        if (text[i] != ' ' || i + 1 >= limit) return false
        var j = i - 1
        while (j >= 0 && text[j] in CLOSERS) j--
        if (j < 0 || text[j] !in TERMINATORS) return false
        // ". . ." mid-sentence ellipsis: the dot before is part of it, not an ending.
        if (text[j] == '.' && j >= 2 && text[j - 1] == ' ' && text[j - 2] == '.') return false
        val next = text[i + 1]
        return next.isUpperCase() || next in OPENERS
    }

    fun sectionStart(sectionIndex: Int): Int = sectionStarts[sectionIndex]

    fun sectionEnd(sectionIndex: Int): Int =
        if (sectionIndex + 1 < sectionStarts.size) sectionStarts[sectionIndex + 1] else text.length

    /** Reader position → charOffset, using progression (0–1) within a section. */
    fun charOffsetOf(sectionIndex: Int, progression: Double): Int {
        val start = sectionStart(sectionIndex)
        val len = sectionEnd(sectionIndex) - start
        return start + (progression.coerceIn(0.0, 1.0) * len).toInt().coerceAtMost((len - 1).coerceAtLeast(0))
    }

    /** charOffset → reader position as (sectionIndex, progression within section). */
    fun progressionOf(charOffset: Int): Pair<Int, Double> {
        val si = paragraphAt(charOffset).sectionIndex
        val start = sectionStart(si)
        val len = sectionEnd(si) - start
        return si to if (len == 0) 0.0 else ((charOffset - start).toDouble() / len).coerceIn(0.0, 1.0)
    }

    /**
     * Refine a coarse reader position with a text snippet (e.g. a Readium
     * locator's highlight text). Returns the start of the occurrence of the
     * snippet's words in the section nearest the progression estimate, or the
     * estimate itself if the snippet isn't found.
     */
    fun resolve(sectionIndex: Int, progression: Double, snippet: String?): Int {
        val estimate = charOffsetOf(sectionIndex, progression)
        val needle = snippet?.let { s -> Normalize.words(s).map { Normalize.token(it.value) }.toList() }
        if (needle.isNullOrEmpty()) return estimate
        val from = wordIndexAt(sectionStart(sectionIndex))
        val to = wordIndexAt(sectionEnd(sectionIndex))
        var best = -1
        for (i in from..(to - needle.size)) {
            if (needle.indices.all { words[i + it].norm == needle[it] }) {
                if (best < 0 || kotlin.math.abs(words[i].charStart - estimate) < kotlin.math.abs(words[best].charStart - estimate)) {
                    best = i
                }
            }
        }
        return if (best >= 0) words[best].charStart else estimate
    }

    companion object {
        fun build(sections: List<Section>): BookText {
            val sb = StringBuilder()
            val words = ArrayList<Word>()
            val paragraphs = ArrayList<ParagraphRef>()
            val sectionStarts = IntArray(sections.size)
            sections.forEachIndexed { si, section ->
                sectionStarts[si] = sb.length
                section.paragraphs.forEachIndexed { pi, raw ->
                    val p = Normalize.paragraph(raw)
                    if (p.isNotEmpty()) {
                        val start = sb.length
                        sb.append(p)
                        for (m in Normalize.words(p)) {
                            words += Word(Normalize.token(m.value), start + m.range.first, start + m.range.last + 1)
                        }
                        paragraphs += ParagraphRef(si, pi, start, sb.length)
                        sb.append('\n')
                    }
                }
            }
            return BookText(sb.toString(), words, paragraphs, sectionStarts)
        }
    }
}
