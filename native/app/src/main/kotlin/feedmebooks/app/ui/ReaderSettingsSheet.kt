package feedmebooks.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import feedmebooks.app.reader.ReaderPrefs
import feedmebooks.app.reader.ReaderSettings
import feedmebooks.app.reader.ReaderTheme

/** Theme, text size, layout and read-along options. Changes apply immediately. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReaderSettingsSheet(showFollow: Boolean, onDismiss: () -> Unit) {
    val prefs by ReaderSettings.prefs.collectAsState()
    val sizes = ReaderPrefs.FONT_SIZES
    val sizeIndex = sizes.indexOf(prefs.fontSizePercent).let { if (it < 0) sizes.indexOf(100) else it }
    fun step(by: Int) = ReaderSettings.update { it.copy(fontSizePercent = sizes[(sizeIndex + by).coerceIn(0, sizes.size - 1)]) }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.padding(horizontal = 20.dp).padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("Reading", style = MaterialTheme.typography.titleMedium)

            Text("Theme", style = MaterialTheme.typography.labelLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ReaderTheme.entries.forEach { theme ->
                    FilterChip(
                        selected = prefs.theme == theme,
                        onClick = { ReaderSettings.update { it.copy(theme = theme) } },
                        label = { Text(theme.label) },
                    )
                }
            }

            Text("Text size", style = MaterialTheme.typography.labelLarge)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = { step(-1) }, enabled = sizeIndex > 0) { Text("A", fontSize = 13.sp) }
                Text("${prefs.fontSizePercent}%", style = MaterialTheme.typography.bodyLarge)
                OutlinedButton(onClick = { step(+1) }, enabled = sizeIndex < sizes.size - 1) { Text("A", fontSize = 22.sp) }
            }

            Text("Layout", style = MaterialTheme.typography.labelLarge)
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                SegmentedButton(
                    selected = !prefs.scroll,
                    onClick = { ReaderSettings.update { it.copy(scroll = false) } },
                    shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
                ) { Text("Pages") }
                SegmentedButton(
                    selected = prefs.scroll,
                    onClick = { ReaderSettings.update { it.copy(scroll = true) } },
                    shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
                ) { Text("Scroll") }
            }

            if (showFollow) {
                Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Follow the narrator", style = MaterialTheme.typography.bodyLarge)
                        Text(
                            "While the audio plays, highlight the sentence being read and turn the pages to keep up.",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    Switch(
                        checked = prefs.followNarrator,
                        onCheckedChange = { on -> ReaderSettings.update { it.copy(followNarrator = on) } },
                    )
                }
            }
        }
    }
}
