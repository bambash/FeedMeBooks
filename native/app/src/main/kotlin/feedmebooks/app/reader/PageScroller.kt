package feedmebooks.app.reader

import org.json.JSONTokener
import org.readium.r2.navigator.epub.EpubNavigatorFragment

/**
 * Vertical movement of the rendered page in scroll mode: paging by screenfuls, and a
 * continuous auto-scroll that runs inside the page (a requestAnimationFrame loop), so it
 * stays smooth no matter how often the app checks on it.
 */
class PageScroller(private val navigator: EpubNavigatorFragment) {

    enum class Edge { NONE, TOP, BOTTOM, BOTH }

    /** Whether the resource is scrolled to its top and/or bottom. */
    suspend fun atEdge(): Edge {
        val script = """
            (function() {
              const el = document.scrollingElement;
              const top = el.scrollTop <= 1;
              const bottom = el.scrollTop + window.innerHeight >= el.scrollHeight - 2;
              return top && bottom ? 'BOTH' : top ? 'TOP' : bottom ? 'BOTTOM' : 'NONE';
            })()
        """.trimIndent()
        val result = decode(navigator.evaluateJavascript(script)) as? String ?: return Edge.NONE
        return runCatching { Edge.valueOf(result) }.getOrDefault(Edge.NONE)
    }

    /** Scrolls smoothly by [screens] screen heights (negative for up). False if already at that end. */
    suspend fun scrollBy(screens: Double): Boolean {
        val script = """
            (function() {
              const el = document.scrollingElement;
              const dy = window.innerHeight * $screens;
              if (dy > 0 && el.scrollTop + window.innerHeight >= el.scrollHeight - 2) return false;
              if (dy < 0 && el.scrollTop <= 1) return false;
              window.scrollBy({ top: dy, left: 0, behavior: 'smooth' });
              return true;
            })()
        """.trimIndent()
        return decode(navigator.evaluateJavascript(script)) == true
    }

    /**
     * Keeps the page scrolling down at [pxPerSecond] (0 stops). The loop lives in the page, so
     * it restarts by itself in a newly loaded resource on the next call. Returns false once
     * the bottom of the resource is reached.
     */
    suspend fun autoScroll(pxPerSecond: Double): Boolean {
        val script = """
            (function() {
              let s = window.__fmbAutoScroll;
              if (!s) {
                s = window.__fmbAutoScroll = { speed: 0, last: null, carry: 0 };
                const step = (t) => {
                  if (s.last !== null && s.speed > 0) {
                    // Whole pixels only; keep the fraction for the next frame so slow speeds still move.
                    s.carry += s.speed * Math.min(t - s.last, 100) / 1000;
                    const whole = Math.floor(s.carry);
                    if (whole >= 1) {
                      document.scrollingElement.scrollTop += whole;
                      s.carry -= whole;
                    }
                  }
                  s.last = t;
                  window.requestAnimationFrame(step);
                };
                window.requestAnimationFrame(step);
              }
              s.speed = $pxPerSecond;
              const el = document.scrollingElement;
              return el.scrollTop + window.innerHeight < el.scrollHeight - 2;
            })()
        """.trimIndent()
        return decode(navigator.evaluateJavascript(script)) == true
    }

    private fun decode(raw: String?): Any? = raw?.let { runCatching { JSONTokener(it).nextValue() }.getOrNull() }
}
