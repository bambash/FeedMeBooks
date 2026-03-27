/**
 * Generates a self-contained HTML page that uses epub.js to render an epub file.
 * epub.js and JSZip are loaded from a CDN (requires internet on first load;
 * cached by the WebView thereafter).
 *
 * Communication protocol:
 *   RN → WebView (postMessage):
 *     { type: 'load',  base64: string, cfi?: string, theme: ThemeData }
 *     { type: 'next' }
 *     { type: 'prev' }
 *     { type: 'goToCfi', cfi: string }
 *     { type: 'goToPercentage', percentage: number }  // 0-1, requires locations to be generated
 *     { type: 'setTheme', theme: ThemeData }
 *     { type: 'setFontSize', size: number }
 *
 *   WebView → RN (postMessage via ReactNativeWebView):
 *     { type: 'ready' }
 *     { type: 'locationChanged', cfi: string, percentage: number }
 *     { type: 'error', message: string }
 */

export interface EpubTheme {
  background: string;
  color: string;
  fontSize: number;
}

export function buildEpubHtml(theme: EpubTheme): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%; height: 100%;
      background: ${theme.background};
      overflow: hidden;
    }
    #viewer {
      width: 100%;
      height: 100%;
    }
    .nav-zone {
      position: fixed;
      top: 0; bottom: 0;
      width: 38%;
      z-index: 5;
      display: flex;
      align-items: center;
      opacity: 0;
      transition: opacity 0.15s;
      pointer-events: none;
    }
    .nav-zone.active { opacity: 1; }
    .nav-prev { left: 0; justify-content: flex-start; padding-left: 12px; }
    .nav-next { right: 0; justify-content: flex-end; padding-right: 12px; }
    .nav-arrow {
      font-size: 28px;
      color: rgba(255,255,255,0.55);
      text-shadow: 0 0 8px rgba(0,0,0,0.8);
      user-select: none;
    }
    #error {
      display: none;
      position: fixed;
      inset: 0;
      background: ${theme.background};
      color: #EF4444;
      font-family: system-ui, sans-serif;
      font-size: 14px;
      padding: 24px;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    #loading {
      position: fixed;
      inset: 0;
      background: ${theme.background};
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .spinner {
      width: 32px; height: 32px;
      border: 3px solid #2A2A3A;
      border-top-color: #7C3AED;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="loading"><div class="spinner"></div></div>
  <div id="viewer"></div>
  <div id="error"></div>
  <div class="nav-zone nav-prev" id="navPrev"><span class="nav-arrow">‹</span></div>
  <div class="nav-zone nav-next" id="navNext"><span class="nav-arrow">›</span></div>

  <script>
    var book = null;
    var rendition = null;
    var pendingCfi = null;
    var locationsReady = false;
    var pendingPercentage = null;

    function send(data) {
      try {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(data));
        }
      } catch(e) {}
    }

    function showError(msg) {
      var el = document.getElementById('error');
      el.style.display = 'flex';
      el.textContent = 'Error: ' + msg;
      document.getElementById('loading').style.display = 'none';
      send({ type: 'error', message: msg });
    }

    function applyTheme(theme) {
      document.body.style.background = theme.background;
      if (rendition) {
        rendition.themes.default({
          'body': {
            'color': theme.color + ' !important',
            'background': theme.background + ' !important',
            'font-size': theme.fontSize + 'px !important',
            'line-height': '1.6 !important',
          }
        });
        rendition.themes.select('default');
      }
    }

    function loadBook(base64, cfi, theme) {
      try {
        book = ePub(base64, { encoding: 'base64' });
        rendition = book.renderTo('viewer', {
          width: window.innerWidth,
          height: window.innerHeight,
          flow: 'paginated',
          spread: 'none',
          minSpreadWidth: 9999,
        });

        applyTheme(theme);

        var displayCfi = cfi || undefined;
        rendition.display(displayCfi).then(function() {
          document.getElementById('loading').style.display = 'none';
          send({ type: 'ready' });
          // Generate locations in the background for percentage-based navigation
          book.locations.generate(1024).then(function() {
            locationsReady = true;
            if (pendingPercentage !== null) {
              var cfi = book.locations.cfiFromPercentage(pendingPercentage);
              if (cfi) rendition.display(cfi);
              pendingPercentage = null;
            }
          }).catch(function() {});
        }).catch(function(err) {
          showError(err && err.message ? err.message : String(err));
        });

        rendition.on('relocated', function(location) {
          send({
            type: 'locationChanged',
            cfi: location.start.cfi,
            percentage: location.start.percentage || 0,
          });
        });

      } catch(err) {
        showError(err && err.message ? err.message : String(err));
      }
    }

    // Tap zones: right 40% → next, left 40% → prev, middle 20% → ignored
    // Also handle swipe for users who prefer it
    var touchStartX = 0;
    var touchStartY = 0;
    var touchMoved = false;
    document.addEventListener('touchstart', function(e) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchMoved = false;
    }, { passive: true });
    document.addEventListener('touchmove', function(e) {
      var dx = Math.abs(e.touches[0].clientX - touchStartX);
      var dy = Math.abs(e.touches[0].clientY - touchStartY);
      if (dx > 10 || dy > 10) touchMoved = true;
    }, { passive: true });
    document.addEventListener('touchend', function(e) {
      var endX = e.changedTouches[0].clientX;
      var dx = endX - touchStartX;
      var dy = e.changedTouches[0].clientY - touchStartY;
      if (!rendition) return;
      // Horizontal swipe (more horizontal than vertical, >50px)
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) rendition.next();
        else        rendition.prev();
        return;
      }
      // Tap (no significant movement)
      if (!touchMoved) {
        var w = window.innerWidth;
        if (endX > w * 0.6) {
          flashZone('navNext');
          rendition.next();
        } else if (endX < w * 0.4) {
          flashZone('navPrev');
          rendition.prev();
        }
      }
    }, { passive: true });

    function flashZone(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.classList.add('active');
      setTimeout(function() { el.classList.remove('active'); }, 200);
    }

    // Keyboard navigation
    document.addEventListener('keydown', function(e) {
      if (!rendition) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') rendition.next();
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   rendition.prev();
    });

    // Message handler from React Native
    function handleMessage(event) {
      try {
        var data = JSON.parse(event.data);
        switch (data.type) {
          case 'load':
            loadBook(data.base64, data.cfi, data.theme);
            break;
          case 'next':
            if (rendition) rendition.next();
            break;
          case 'prev':
            if (rendition) rendition.prev();
            break;
          case 'goToCfi':
            if (rendition) rendition.display(data.cfi);
            break;
          case 'goToPercentage':
            if (locationsReady) {
              var targetCfi = book.locations.cfiFromPercentage(data.percentage);
              if (targetCfi) rendition.display(targetCfi);
            } else {
              pendingPercentage = data.percentage;
            }
            break;
          case 'setTheme':
            applyTheme(data.theme);
            break;
          case 'setFontSize':
            if (rendition) {
              rendition.themes.fontSize(data.size + 'px');
            }
            break;
        }
      } catch(e) {}
    }

    // Android uses document, iOS uses window
    document.addEventListener('message', handleMessage);
    window.addEventListener('message', handleMessage);
  </script>
</body>
</html>`;
}
