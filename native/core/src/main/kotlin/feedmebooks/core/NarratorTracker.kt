package feedmebooks.core

data class TrackerConfig(
    /** How long a confident fix is carried forward before the audio is probed again. */
    val probeIntervalMs: Long = 30_000,
    /** How soon to try again after a probe that found nothing (silence, music, credits). */
    val retryIntervalMs: Long = 8_000,
    /** A jump back in the audio bigger than this (a seek) invalidates the fix. */
    val rewindToleranceMs: Long = 1_000,
)

/**
 * Follows the narrator while the audio plays. A probe (one [Handoff.audioToText]) gives a
 * fix: the narrator's text position at a known playhead plus the local narration rate. Between
 * probes the position is extrapolated from that fix, which is accurate to about a sentence for
 * tens of seconds, and the caller probes again when [needsProbe] says so. Pure logic: the
 * caller runs the probes, because on the device they are serialized behind the speech model.
 */
class NarratorTracker(private val config: TrackerConfig = TrackerConfig()) {
    var fix: TextTarget? = null
        private set

    /** After a probe that threw, don't try again before this playhead time. */
    private var retryAt: Long? = null

    /** Should the caller run a probe at [audioMs] before trusting [estimate]? */
    fun needsProbe(audioMs: Long): Boolean {
        retryAt?.let { if (audioMs < it) return false else retryAt = null }
        val f = fix ?: return true
        if (audioMs < f.audioMs - config.rewindToleranceMs) return true
        val age = audioMs - f.audioMs
        return age > if (f.confident) config.probeIntervalMs else config.retryIntervalMs
    }

    /** Records the result of a probe. */
    fun fixed(target: TextTarget) {
        fix = target
        retryAt = null
    }

    /** Records a probe that failed outright (decode or recognition error), so retries are spaced out. */
    fun failed(audioMs: Long) {
        retryAt = audioMs + config.retryIntervalMs
    }

    /** Forget the fix, e.g. after a seek, so the next tick probes. */
    fun reset() {
        fix = null
        retryAt = null
    }

    /** The narrator's text position at [audioMs], or null before the first probe. */
    fun estimate(audioMs: Long): Int? = fix?.at(audioMs)
}
