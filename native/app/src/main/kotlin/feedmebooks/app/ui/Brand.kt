package feedmebooks.app.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

/**
 * The FeedMeBooks look: ink and amber on paper.
 *
 * Ink is the brand colour: buttons, links, the launcher background. Amber is the narrator's
 * voice: it marks everything the audio does to the page (the sentence being read, the voice
 * bars in the mark, listening progress). Surfaces are paper by day, night after dark, and
 * sepia on request to match Readium's page. Headings are set in a serif, like a book.
 *
 * The window, splash screen and launcher use the same values from res/values/colors.xml,
 * and docs/brand.md explains the choices.
 */
object Brand {
    val Ink = Color(0xFF2F4170)
    val InkDeep = Color(0xFF1F2E55)
    val InkLight = Color(0xFFB4C4F0)
    val Amber = Color(0xFFF5B52E)
    val AmberDeep = Color(0xFF7A5200)
    val Paper = Color(0xFFFCFAF6)
    val Night = Color(0xFF121316)

    /** Readium decoration tints (ARGB) for the paragraph and sentence the narrator is reading. */
    const val PARAGRAPH_TINT = 0x33F5B52E
    const val SENTENCE_TINT = 0x99F5B52E.toInt()
    /** Brighter amber reads better on the dark page. */
    const val PARAGRAPH_TINT_DARK = 0x40FFC65C
    const val SENTENCE_TINT_DARK = 0xB3FFC65C.toInt()

    val LightScheme: ColorScheme = lightColorScheme(
        primary = Ink,
        onPrimary = Color.White,
        primaryContainer = Color(0xFFDCE3F7),
        onPrimaryContainer = Color(0xFF0C1A3B),
        secondary = Color(0xFF565E73),
        onSecondary = Color.White,
        secondaryContainer = Color(0xFFE1E5F0),
        onSecondaryContainer = Color(0xFF1A2032),
        tertiary = AmberDeep,
        onTertiary = Color.White,
        tertiaryContainer = Color(0xFFFFE2A3),
        onTertiaryContainer = Color(0xFF2A1B00),
        background = Paper,
        onBackground = Color(0xFF1C1B18),
        surface = Paper,
        onSurface = Color(0xFF1C1B18),
        surfaceVariant = Color(0xFFE6E2D9),
        onSurfaceVariant = Color(0xFF47484F),
        surfaceContainerLowest = Color.White,
        surfaceContainerLow = Color(0xFFF6F3EC),
        surfaceContainer = Color(0xFFF0ECE4),
        surfaceContainerHigh = Color(0xFFEAE6DD),
        surfaceContainerHighest = Color(0xFFE4E0D6),
        outline = Color(0xFF777882),
        outlineVariant = Color(0xFFC8C6CD),
        inverseSurface = Color(0xFF31302D),
        inverseOnSurface = Color(0xFFF4F0E8),
        inversePrimary = InkLight,
    )

    val DarkScheme: ColorScheme = darkColorScheme(
        primary = InkLight,
        onPrimary = Color(0xFF0F2149),
        primaryContainer = Color(0xFF2A3C68),
        onPrimaryContainer = Color(0xFFDCE3F7),
        secondary = Color(0xFFBEC6D9),
        onSecondary = Color(0xFF283043),
        secondaryContainer = Color(0xFF3E465A),
        onSecondaryContainer = Color(0xFFDAE2F5),
        tertiary = Color(0xFFFFC65C),
        onTertiary = Color(0xFF402D00),
        tertiaryContainer = Color(0xFF5C4300),
        onTertiaryContainer = Color(0xFFFFE2A3),
        background = Night,
        onBackground = Color(0xFFE6E2DC),
        surface = Night,
        onSurface = Color(0xFFE6E2DC),
        surfaceVariant = Color(0xFF45464F),
        onSurfaceVariant = Color(0xFFC6C5CF),
        surfaceContainerLowest = Color(0xFF0C0D10),
        surfaceContainerLow = Color(0xFF1A1B1F),
        surfaceContainer = Color(0xFF1E1F24),
        surfaceContainerHigh = Color(0xFF282A30),
        surfaceContainerHighest = Color(0xFF33353B),
        outline = Color(0xFF908F99),
        outlineVariant = Color(0xFF45464F),
        inverseSurface = Color(0xFFE6E2DC),
        inverseOnSurface = Color(0xFF2F3034),
        inversePrimary = Ink,
    )

    /** Warm paper tones matching Readium's sepia page, with ink darkened towards brown. */
    val SepiaScheme: ColorScheme = lightColorScheme(
        primary = Color(0xFF4E4A6E),
        onPrimary = Color.White,
        primaryContainer = Color(0xFFE4DED0),
        onPrimaryContainer = Color(0xFF1E1A2E),
        secondary = Color(0xFF6D5C45),
        onSecondary = Color.White,
        secondaryContainer = Color(0xFFE3D5BB),
        onSecondaryContainer = Color(0xFF2A1A05),
        tertiary = AmberDeep,
        onTertiary = Color.White,
        tertiaryContainer = Color(0xFFFFE2A3),
        onTertiaryContainer = Color(0xFF2A1B00),
        background = Color(0xFFFAF4E8),
        onBackground = Color(0xFF1E1A14),
        surface = Color(0xFFFAF4E8),
        onSurface = Color(0xFF1E1A14),
        surfaceVariant = Color(0xFFEDE3D0),
        onSurfaceVariant = Color(0xFF4A4034),
        surfaceContainerLowest = Color(0xFFFFFCF4),
        surfaceContainerLow = Color(0xFFF6EFE0),
        surfaceContainer = Color(0xFFF1E8D8),
        surfaceContainerHigh = Color(0xFFECE1CF),
        surfaceContainerHighest = Color(0xFFE6DAC6),
        outline = Color(0xFF857463),
        outlineVariant = Color(0xFFD3C6B0),
    )

    /** Headings in a serif, body text in the system sans: a book, not a dashboard. */
    val Typography: Typography = Typography().let { t ->
        t.copy(
            displayLarge = t.displayLarge.copy(fontFamily = FontFamily.Serif),
            displayMedium = t.displayMedium.copy(fontFamily = FontFamily.Serif),
            displaySmall = t.displaySmall.copy(fontFamily = FontFamily.Serif),
            headlineLarge = t.headlineLarge.copy(fontFamily = FontFamily.Serif),
            headlineMedium = t.headlineMedium.copy(fontFamily = FontFamily.Serif),
            headlineSmall = t.headlineSmall.copy(fontFamily = FontFamily.Serif),
            titleLarge = t.titleLarge.copy(fontFamily = FontFamily.Serif),
        )
    }

    /** Soft corners throughout, like the launcher mark. */
    val Shapes: Shapes = Shapes(
        extraSmall = RoundedCornerShape(6.dp),
        small = RoundedCornerShape(10.dp),
        medium = RoundedCornerShape(14.dp),
        large = RoundedCornerShape(20.dp),
        extraLarge = RoundedCornerShape(28.dp),
    )
}
