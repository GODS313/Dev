package net.etebarami.smsgateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

class SmsInboxReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val messages = try { Telephony.Sms.Intents.getMessagesFromIntent(intent) } catch (_: Exception) { return }
        if (messages.isEmpty()) return
        val sender = messages.firstOrNull()?.originatingAddress ?: return
        val body = messages.joinToString("") { it.messageBody.orEmpty() }
        val time = messages.minOfOrNull { it.timestampMillis } ?: System.currentTimeMillis()
        InboxQueue.add(context.applicationContext, sender, body, time)
    }
}
