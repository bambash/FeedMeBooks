package feedmebooks.app.book

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.readium.r2.shared.publication.Link
import org.readium.r2.shared.publication.Locator
import org.readium.r2.shared.publication.Publication

/** One row of the table of contents, flattened with its nesting depth. */
data class TocEntry(val title: String, val link: Link, val depth: Int) {
    val href: String get() = link.href.toString().substringBefore('#')
}

/** The publication's table of contents flattened, falling back to the reading order. */
fun Publication.tocEntries(): List<TocEntry> {
    fun flatten(links: List<Link>, depth: Int): List<TocEntry> = links.flatMap { link ->
        listOf(TocEntry(link.title?.trim().orEmpty().ifEmpty { "Untitled" }, link, depth)) + flatten(link.children, depth + 1)
    }
    return flatten(tableOfContents, 0).ifEmpty {
        readingOrder.mapIndexed { i, link -> TocEntry(link.title?.trim().orEmpty().ifEmpty { "Section ${i + 1}" }, link, 0) }
    }
}

/** The entry the reader is in: the first one for the current resource. */
fun List<TocEntry>.entryFor(locator: Locator?): TocEntry? {
    val href = locator?.href?.toString()?.substringBefore('#') ?: return null
    return firstOrNull { it.href == href } ?: firstOrNull { href.endsWith("/" + it.href) || it.href.endsWith("/$href") }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContentsSheet(entries: List<TocEntry>, current: Locator?, onPick: (TocEntry) -> Unit, onDismiss: () -> Unit) {
    val here = entries.entryFor(current)
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(bottom = 24.dp)) {
            Text("Contents", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
            if (entries.isEmpty()) {
                Text("This book has no table of contents.", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(20.dp))
            }
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 520.dp)) {
                items(entries) { entry ->
                    val isHere = entry == here
                    Text(
                        entry.title,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = if (isHere) FontWeight.Bold else FontWeight.Normal,
                        color = if (isHere) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onPick(entry) }
                            .padding(start = (20 + 16 * entry.depth).dp, end = 20.dp, top = 12.dp, bottom = 12.dp),
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}
