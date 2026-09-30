package feedmebooks.app.book

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import feedmebooks.app.audio.formatDuration

/** Pick when playback should pause by itself. [onPick] gets minutes, or null to turn the timer off. */
@Composable
fun SleepTimerDialog(remainingMs: Long?, onPick: (minutes: Int?) -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Sleep timer") },
        text = {
            Column {
                Text(
                    remainingMs?.let { "Pausing in ${formatDuration(it)}. The last 20 seconds fade out." }
                        ?: "Pause the audio after…",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
                for (minutes in CHOICES) {
                    TextButton(onClick = { onPick(minutes) }, modifier = Modifier.fillMaxWidth()) {
                        Text("$minutes minutes", Modifier.fillMaxWidth())
                    }
                }
                if (remainingMs != null) {
                    TextButton(onClick = { onPick(null) }, modifier = Modifier.fillMaxWidth()) {
                        Text("Turn the timer off", Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

private val CHOICES = listOf(10, 20, 30, 45, 60)
