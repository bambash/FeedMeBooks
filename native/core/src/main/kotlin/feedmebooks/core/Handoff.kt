package feedmebooks.core

import kotlin.math.max

/** Speech recognition over a slice of the global audio timeline. Blocking; call off the main thread. */
fun interface Transcriber {
    fun transcribe(startMs: Long, endMs: Long): List<TranscriptWord>
}

data class HandoffConfig(
    /** Audio→text: how much audio before the playhead to transcribe. */
    val listenWindowMs: Long = 20_000,
    /** Text→audio: half-width of each probe window around the estimate. */
    val probeHalfWindowMs: Long = 10_000,
    val maxProbes: Int = 3,
    /** Search this many book words either side of the prior before falling back to the whole book. */
    val minSearchWords: Int = 4_000,
    val searchFraction: Double = 0.1,
    val minConfidence: Double = 0.4,
)

/** Where to open the book. [confident] is false when no match was found and this is only an estimate. */
data class TextTarget(
    val charOffset: Int,
    val paragraph: ParagraphRef,
    val confident: Boolean,
    val anchors: AnchorMap,
)

/** Where to start the audio. Callers typically seek a second or two earlier for context. */
data class AudioTarget(
    val audioMs: Long,
    val confident: Boolean,
    val probes: Int,
    val anchors: AnchorMap,
)

/**
 * Just-in-time position matching at the moment of a mode switch: transcribe a
 * short slice of audio and find it in the book. Each successful match returns
 * an updated [AnchorMap] for the caller to persist, so later estimates start closer.
 */
class Handoff(
    private val book: BookText,
    private val transcriber: Transcriber,
    private val config: HandoffConfig = HandoffConfig(),
) {
    /** Resume reading: where in the text is the narrator at [audioMs]? */
    fun audioToText(audioMs: Long, anchors: AnchorMap): TextTarget {
        val transcript = transcriber.transcribe(max(0, audioMs - config.listenWindowMs), audioMs)
        val match = locate(transcript, anchors.audioToText(audioMs))
            ?: return textTarget(anchors.audioToText(audioMs), false, anchors)

        val first = match.pairs.first()
        val last = match.pairs.last()
        // The last recognised word can trail the playhead by a few seconds; extrapolate at the local rate.
        val rate = localRate(match, anchors)
        val offset = (last.charOffset + (audioMs - last.audioMs) * rate).toInt().coerceIn(0, book.length - 1)
        val updated = anchors.with(Anchor(first.charOffset, first.audioMs), Anchor(last.charOffset, last.audioMs))
        return textTarget(offset, true, updated)
    }

    /** Resume listening: when does the narrator read [charOffset]? */
    fun textToAudio(charOffset: Int, anchors: AnchorMap): AudioTarget {
        var map = anchors
        var estimate = map.textToAudio(charOffset)
        var halfWindow = config.probeHalfWindowMs
        for (probe in 1..config.maxProbes) {
            val start = (estimate - halfWindow).coerceIn(0, map.totalMs)
            val end = (estimate + halfWindow).coerceIn(0, map.totalMs)
            val match = locate(transcriber.transcribe(start, end), charOffset)
            if (match == null) {
                // Heard nothing usable (intro music, credits, silence): listen wider around the same guess.
                halfWindow *= 2
                continue
            }

            val pairs = match.pairs
            map = map.with(Anchor(pairs.first().charOffset, pairs.first().audioMs), Anchor(pairs.last().charOffset, pairs.last().audioMs))

            val after = pairs.indexOfFirst { it.charOffset >= charOffset }
            if (after >= 0 && pairs[after].charOffset == charOffset) {
                return AudioTarget(pairs[after].audioMs, true, probe, map)
            }
            if (after > 0) {
                val a = pairs[after - 1]
                val b = pairs[after]
                val f = (charOffset - a.charOffset).toDouble() / (b.charOffset - a.charOffset)
                return AudioTarget(a.audioMs + (f * (b.audioMs - a.audioMs)).toLong(), true, probe, map)
            }
            // Target lies outside what we heard: step from the nearest matched word at the local rate.
            val nearest = if (after == 0) pairs.first() else pairs.last()
            estimate = (nearest.audioMs + (charOffset - nearest.charOffset) / localRate(match, map)).toLong()
                .coerceIn(0, map.totalMs)
        }
        return AudioTarget(estimate, false, config.maxProbes, map)
    }

    private fun locate(transcript: List<TranscriptWord>, priorChar: Int): Match? {
        if (transcript.isEmpty()) return null
        val prior = book.wordIndexAt(priorChar)
        val half = max(config.minSearchWords, (book.words.size * config.searchFraction).toInt())
        return Matcher.align(transcript, book, prior - half, prior + half, prior, config.minConfidence)
            ?: if (half * 2 < book.words.size) {
                Matcher.align(transcript, book, 0, book.words.size, prior, config.minConfidence)
            } else {
                null
            }
    }

    /** Characters per millisecond, from the match itself when it spans enough speech, else from the anchors. */
    private fun localRate(match: Match, anchors: AnchorMap): Double {
        val first = match.pairs.first()
        val last = match.pairs.last()
        val spanMs = last.audioMs - first.audioMs
        if (spanMs >= 3_000) {
            val rate = (last.charOffset - first.charOffset).toDouble() / spanMs
            if (rate in MIN_RATE..MAX_RATE) return rate
        }
        return anchors.totalChars.toDouble() / anchors.totalMs
    }

    private fun textTarget(charOffset: Int, confident: Boolean, anchors: AnchorMap) =
        TextTarget(charOffset, book.paragraphAt(charOffset), confident, anchors)

    private companion object {
        // Plausible narration speeds: roughly 5–50 characters per second.
        const val MIN_RATE = 0.005
        const val MAX_RATE = 0.05
    }
}
