package feedmebooks.app.reader

import org.json.JSONObject
import org.json.JSONTokener
import org.readium.r2.navigator.epub.EpubNavigatorFragment

/**
 * Asks the rendered page directly what is on screen. On a real book, Readium's own answers
 * were off by a page (jumps landed one page early; "first visible element" reported a
 * paragraph near the bottom), so the handoff checks the layout itself.
 *
 * Paragraphs are identified by a whitespace-free text prefix rather than CSS selectors,
 * which are fragile once Readium has injected its own markup.
 */
class PageProbe(private val navigator: EpubNavigatorFragment) {

    enum class Where { VISIBLE, BEFORE, AFTER, MISSING }

    /** The first text block with any line on screen: [ordinal] of [total] text blocks in the resource. */
    data class Visible(val compactText: String, val ordinal: Int, val total: Int)

    /** Is the first line of the paragraph starting with [compactPrefix] on screen, or which way is it? */
    suspend fun where(compactPrefix: String): Where {
        val script = """
            (function() {
              $PRELUDE
              const p = ${JSONObject.quote(compactPrefix)};
              const el = leaves().find(e => squash(e.textContent).startsWith(p));
              if (!el) return 'MISSING';
              const r = el.getClientRects()[0];
              if (!r) return 'MISSING';
              if (onScreen(r)) return 'VISIBLE';
              return (r.left >= W || r.top >= H) ? 'AFTER' : 'BEFORE';
            })()
        """.trimIndent()
        val result = decode(navigator.evaluateJavascript(script)) as? String ?: return Where.MISSING
        return runCatching { Where.valueOf(result) }.getOrDefault(Where.MISSING)
    }

    suspend fun firstVisible(): Visible? {
        val script = """
            (function() {
              $PRELUDE
              const ls = leaves();
              for (let i = 0; i < ls.length; i++) {
                if (Array.from(ls[i].getClientRects()).some(onScreen)) {
                  return JSON.stringify({ text: squash(ls[i].textContent).slice(0, 80), ordinal: i, total: ls.length });
                }
              }
              return null;
            })()
        """.trimIndent()
        val json = decode(navigator.evaluateJavascript(script)) as? String ?: return null
        val o = JSONObject(json)
        return Visible(o.getString("text"), o.getInt("ordinal"), o.getInt("total"))
    }

    /** WebView returns results JSON-encoded ("\"text\"", "null"). */
    private fun decode(raw: String?): Any? =
        raw?.let { runCatching { JSONTokener(it).nextValue() }.getOrNull() }?.takeIf { it != JSONObject.NULL }

    companion object {
        /** Text-bearing leaf blocks; whitespace, soft hyphens and zero-width characters squashed out. */
        private val PRELUDE = """
            const SEL = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,dd,dt,figcaption,td,div';
            const squash = s => s.replace(/[\s­​‌‍﻿]+/g, '');
            const leaves = () => Array.from(document.body.querySelectorAll(SEL))
              .filter(e => !e.querySelector(SEL) && squash(e.textContent).length > 0);
            const W = window.innerWidth, H = window.innerHeight;
            const onScreen = r => r.width > 0 && r.right > 0 && r.left < W && r.bottom > 0 && r.top < H;
        """.trimIndent()

        private val INVISIBLE = setOf('­', '​', '‌', '‍', '﻿')

        /** Kotlin twin of the page's `squash`. */
        fun compact(text: String): String = text.filterNot { it.isWhitespace() || it in INVISIBLE }
    }
}
