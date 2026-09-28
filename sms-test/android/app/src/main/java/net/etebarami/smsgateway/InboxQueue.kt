package net.etebarami.smsgateway

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

object InboxQueue {
    @Synchronized fun add(context: Context, phone: String, body: String, receivedAt: Long) {
        if (phone.isBlank() || body.isBlank()) return
        val id = sha256("$phone|$receivedAt|$body")
        val items = read(context)
        if ((0 until items.length()).any { items.optJSONObject(it)?.optString("remote_id") == id }) return
        items.put(JSONObject().put("remote_id", id).put("phone", phone).put("body", body).put("received_at", java.time.Instant.ofEpochMilli(receivedAt).toString()))
        SecretStore.put(context, "inbound_queue", items.toString())
        if (SecretStore.get(context, "token") != null) GatewayWorker.enqueue(context)
    }

    @Synchronized fun pending(context: Context): JSONArray = read(context)

    @Synchronized fun acknowledge(context: Context, remoteId: String) {
        val old = read(context); val remaining = JSONArray()
        for (i in 0 until old.length()) {
            val item = old.optJSONObject(i) ?: continue
            if (item.optString("remote_id") != remoteId) remaining.put(item)
        }
        SecretStore.put(context, "inbound_queue", remaining.toString())
    }

    private fun read(context: Context): JSONArray = try {
        JSONArray(SecretStore.get(context, "inbound_queue") ?: "[]")
    } catch (_: Exception) { JSONArray() }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 0xff) }
}
