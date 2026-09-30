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
 * which are fragile once Readium has injected its own markup. Positions inside a paragraph
 * are "compact" offsets: characters counted with whitespace and invisible characters removed,
 * identically here and in [compact].
 */
class PageProbe(private val navigator: EpubNavigatorFragment) {

    enum class Where { VISIBLE, BEFORE, AFTER, MISSING }

    /**
     * The first text block with any line on screen ([ordinal] of [total] blocks in the
     * resource), and how many compact characters of it are above the screen ([skipped] > 0
     * when the paragraph continues from the previous page).
     */
    data class Visible(val compactText: String, val ordinal: Int, val total: Int, val skipped: Int)

    /** Is the character [compactOffset] of the paragraph starting with [compactPrefix] on screen, or which way is it? */
    suspend fun where(compactPrefix: String, compactOffset: Int = 0): Where {
        val script = """
            (function() {
              $PRELUDE
              const p = ${JSONObject.quote(compactPrefix)};
              const el = leaves().find(e => squash(e.textContent).startsWith(p));
              if (!el) return 'MISSING';
              const r = charRect(el, $compactOffset) || el.getClientRects()[0];
              if (!r) return 'MISSING';
              if (onScreen(r)) return 'VISIBLE';
              return before(r) ? 'BEFORE' : 'AFTER';
            })()
        """.trimIndent()
        val result = decode(navigator.evaluateJavascript(script)) as? String ?: return Where.MISSING
        return runCatching { Where.valueOf(result) }.getOrDefault(Where.MISSING)
    }

    /**
     * Scroll mode: scrolls smoothly so that character [compactOffset] of the paragraph starting
     * with [compactPrefix] sits in the upper part of the screen. False if the paragraph isn't in
     * the current resource.
     */
    suspend fun scrollTo(compactPrefix: String, compactOffset: Int = 0): Boolean {
        val script = """
            (function() {
              $PRELUDE
              const p = ${JSONObject.quote(compactPrefix)};
              const el = leaves().find(e => squash(e.textContent).startsWith(p));
              if (!el) return false;
              const r = charRect(el, $compactOffset) || el.getClientRects()[0];
              if (!r) return false;
              window.scrollBy({ top: r.top - H * $SCROLL_ANCHOR, left: 0, behavior: 'smooth' });
              return true;
            })()
        """.trimIndent()
        return decode(navigator.evaluateJavascript(script)) == true
    }

    suspend fun firstVisible(): Visible? {
        val script = """
            (function() {
              $PRELUDE
              const ls = leaves();
              for (let i = 0; i < ls.length; i++) {
                const el = ls[i];
                if (!Array.from(el.getClientRects()).some(onScreen)) continue;
                const text = squash(el.textContent);
                // Binary search for the first character not above the screen.
                let lo = 0, hi = text.length - 1;
                const first = charRect(el, 0);
                if (first && before(first)) {
                  while (lo < hi) {
                    const mid = (lo + hi) >> 1;
                    const r = charRect(el, mid);
                    if (r && before(r)) lo = mid + 1; else hi = mid;
                  }
                } else {
                  lo = 0;
                }
                return JSON.stringify({ text: text.slice(0, 80), ordinal: i, total: ls.length, skipped: lo });
              }
              return null;
            })()
        """.trimIndent()
        val json = decode(navigator.evaluateJavascript(script)) as? String ?: return null
        val o = JSONObject(json)
        return Visible(o.getString("text"), o.getInt("ordinal"), o.getInt("total"), o.optInt("skipped", 0))
    }

    /** WebView returns results JSON-encoded ("\"text\"", "null"). */
    private fun decode(raw: String?): Any? =
        raw?.let { runCatching { JSONTokener(it).nextValue() }.getOrNull() }?.takeIf { it != JSONObject.NULL }

    companion object {
        /** Where on the screen (fraction of its height) [scrollTo] places the target line. */
        private const val SCROLL_ANCHOR = 0.3

        /**
         * Text-bearing leaf blocks; whitespace, soft hyphens and zero-width characters squashed
         * out; the rect of the n-th compact character; and on-screen tests that work for both
         * paginated (columns off to the left/right) and scrolled layouts.
         */
        private val PRELUDE = """
            const SEL = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,dd,dt,figcaption,td,div';
            const SKIP = /[\s­​‌‍﻿]/;
            const squash = s => s.replace(/[\s­​‌‍﻿]+/g, '');
            const leaves = () => Array.from(document.body.querySelectorAll(SEL))
              .filter(e => !e.querySelector(SEL) && squash(e.textContent).length > 0);
            const W = window.innerWidth, H = window.innerHeight;
            const onScreen = r => r.width > 0 && r.right > 0 && r.left < W && r.bottom > 0 && r.top < H;
            const before = r => r.right <= 0 || r.bottom <= 0;
            const charRect = (el, n) => {
              const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
              let count = 0, node;
              while ((node = walker.nextNode())) {
                const t = node.data;
                for (let i = 0; i < t.length; i++) {
                  if (SKIP.test(t[i])) continue;
                  if (count === n) {
                    const range = document.createRange();
                    range.setStart(node, i);
                    range.setEnd(node, i + 1);
                    const rects = range.getClientRects();
                    return rects.length ? rects[0] : range.getBoundingClientRect();
                  }
                  count++;
                }
              }
              return null;
            };
        """.trimIndent()

        private val INVISIBLE = setOf('­', '​', '‌', '‍', '﻿')

        private fun skipped(c: Char) = c.isWhitespace() || c in INVISIBLE

        /** Kotlin twin of the page's `squash`. */
        fun compact(text: String): String = text.filterNot(::skipped)

        /** The index in [text] of its [compactOffset]-th compact character. */
        fun rawIndex(text: String, compactOffset: Int): Int {
            var count = 0
            for (i in text.indices) {
                if (skipped(text[i])) continue
                if (count == compactOffset) return i
                count++
            }
            return text.length
        }

        /** How many compact characters precede [rawIndex] in [text]. */
        fun compactIndex(text: String, rawIndex: Int): Int =
            (0 until rawIndex.coerceAtMost(text.length)).count { !skipped(text[it]) }
    }
}
