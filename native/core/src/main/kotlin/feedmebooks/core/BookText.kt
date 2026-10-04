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
    fun resolve(sectionIndex: Int, progression: Double, snippet: String?): Int =
        snippet?.let { find(sectionIndex, progression, it) } ?: charOffsetOf(sectionIndex, progression)

    /**
     * Finds [snippet] (e.g. text the reader selected) in a section and returns the book offset
     * where it starts, or null if its words aren't there. When it occurs more than once, the
     * occurrence preceded by the last words of [before] (the text just ahead of the snippet on
     * the page) wins, then the one nearest the [progression] estimate. A long snippet that
     * isn't found as a whole (a footnote marker or caption mixed in) is retried from its first
     * few words, which is enough to place its start.
     */
    fun find(sectionIndex: Int, progression: Double, snippet: String, before: String? = null): Int? {
        val tokens = tokens(snippet)
        if (tokens.isEmpty()) return null
        val estimate = charOffsetOf(sectionIndex, progression)
        val from = wordIndexAt(sectionStart(sectionIndex))
        val end = sectionEnd(sectionIndex)
        var to = wordIndexAt(end) // exclusive: the first word at or after the section end
        if (to < words.size && words[to].charStart < end) to++
        val context = before?.let { tokens(it).takeLast(CONTEXT_WORDS) }.orEmpty()

        fun occurrences(needle: List<String>) = (from..(to - needle.size)).filter { i ->
            needle.indices.all { words[i + it].norm == needle[it] }
        }

        var found = occurrences(tokens)
        if (found.isEmpty() && tokens.size > HEAD_WORDS) found = occurrences(tokens.take(HEAD_WORDS))
        if (found.isEmpty()) return null
        val best = found.minWith(
            compareByDescending<Int> { i -> contextMatch(i, context) }
                .thenBy { i -> kotlin.math.abs(words[i].charStart - estimate) },
        )
        return words[best].charStart
    }

    /** How many of [context]'s trailing words are read, in order, right before word [index]. */
    private fun contextMatch(index: Int, context: List<String>): Int {
        var n = 0
        while (n < context.size && index - 1 - n >= 0 && words[index - 1 - n].norm == context[context.size - 1 - n]) n++
        return n
    }

    private fun tokens(text: String): List<String> = Normalize.words(text).map { Normalize.token(it.value) }.toList()

    companion object {
        /** Words of the snippet tried on their own when the whole snippet isn't in the text. */
        private const val HEAD_WORDS = 6
        /** Trailing words of the "before" context used to tell repeated phrases apart. */
        private const val CONTEXT_WORDS = 3

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
