package net.etebarami.smsgateway

import android.content.Context
import android.os.Build
import android.util.Base64
import androidx.work.CoroutineWorker
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.SecureRandom
import java.util.concurrent.TimeUnit

class GatewayWorker(ctx: Context, params: WorkerParameters): CoroutineWorker(ctx,params) {
    private val prefs=ctx.getSharedPreferences("gateway",Context.MODE_PRIVATE)

    override suspend fun doWork()=withContext(Dispatchers.IO){
        try {
            var base=prefs.getString("base_url","")?:""
            if(base.isBlank()) {
                base="https://etebarami.net/sendo"
                prefs.edit().putString("base_url",base).apply()
            }
            require(base.startsWith("https://")){"HTTPS is required"}
            var token=SecretStore.get(applicationContext,"token")
            if(token.isNullOrBlank()) {
                token=connectOrPoll(base)
                if(token.isNullOrBlank()) {
                    val state=SecretStore.get(applicationContext,"enrollment_state")
                    if(state!="rejected"&&state!="expired") enqueueDelayed(applicationContext,30)
                    return@withContext Result.success()
                }
            }
            request(base,"POST","/api/gateway/heartbeat",token,JSONObject()
                .put("device_model",Build.MANUFACTURER+" "+Build.MODEL)
                .put("android_version",Build.VERSION.RELEASE)
                .put("app_version","0.7.0")
                .put("phone_number",prefs.getString("phone_number",""))
                .put("operator",prefs.getString("operator","")))
            val jobResponse=request(base,"GET","/api/gateway/jobs",token,null)
            val jobs=jobResponse.optJSONArray("jobs")
            if(jobs!=null) for(i in 0 until jobs.length()) {
                val job=jobs.getJSONObject(i)
                try { SmsSender.send(applicationContext,job.getLong("id"),job.getString("phone"),job.getString("body")) }
                catch(e:Exception) { ReportQueue.add(applicationContext,job.getLong("id"),"failed",e.message?:"send error") }
            }
            if(jobs!=null&&jobs.length()>0) enqueueDelayed(applicationContext,jobResponse.optLong("poll_after_seconds",30))
            val inbox=InboxQueue.pending(applicationContext)
            for(i in 0 until inbox.length()) {
                val item=inbox.optJSONObject(i)?:continue
                val remoteId=item.optString("remote_id")
                request(base,"POST","/api/gateway/inbox",token,JSONObject()
                    .put("remote_id",remoteId).put("phone",item.optString("phone"))
                    .put("body",item.optString("body")).put("received_at",item.optString("received_at")))
                InboxQueue.acknowledge(applicationContext,remoteId)
            }
            Result.success()
        } catch(e:Exception) {
            if(runAttemptCount<5) Result.retry() else Result.failure()
        }
    }

    /** One-tap Telegram approval replaces manual pairing codes on a fresh install. */
    private fun connectOrPoll(base:String):String? {
        var requestId=SecretStore.get(applicationContext,"enrollment_request_id")
        var pollSecret=SecretStore.get(applicationContext,"enrollment_poll_secret")
        if(requestId.isNullOrBlank()||pollSecret.isNullOrBlank()) {
            val random=ByteArray(48).also { SecureRandom().nextBytes(it) }
            requestId=random.copyOfRange(0,16).joinToString("") { "%02x".format(it.toInt() and 0xff) }
            pollSecret=Base64.encodeToString(random.copyOfRange(16,48),Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            SecretStore.put(applicationContext,"enrollment_request_id",requestId)
            SecretStore.put(applicationContext,"enrollment_poll_secret",pollSecret)
        }
        val requestIdValue=requestId?:throw IllegalStateException("Enrollment request ID is missing")
        val pollSecretValue=pollSecret?:throw IllegalStateException("Enrollment poll secret is missing")
        if(SecretStore.get(applicationContext,"enrollment_submitted")!="yes") {
            val requestBody=JSONObject()
                .put("request_id",requestIdValue).put("poll_secret",pollSecretValue)
                .put("device_name",Build.MANUFACTURER+" "+Build.MODEL)
                .put("device_model",Build.MANUFACTURER+" "+Build.MODEL)
                .put("android_version",Build.VERSION.RELEASE).put("app_version","0.7.0")
                .put("phone_number",prefs.getString("phone_number",""))
                .put("operator",prefs.getString("operator",""))
            val started=request(base,"POST","/api/gateway/enrollment/request",null,requestBody)
            if(!started.optBoolean("ok")) throw IllegalStateException("Could not request device approval")
            SecretStore.put(applicationContext,"enrollment_submitted","yes")
            SecretStore.put(applicationContext,"enrollment_state","pending")
        }
        val rid=URLEncoder.encode(requestIdValue,"UTF-8");val secret=URLEncoder.encode(pollSecretValue,"UTF-8")
        val state=request(base,"GET","/api/gateway/enrollment/status?request_id=$rid&poll_secret=$secret",null,null)
        return when(state.optString("status")) {
            "approved" -> {
                val issued=state.optString("token")
                if(issued.length<32) throw IllegalStateException("Approved connection did not return a token")
                SecretStore.put(applicationContext,"token",issued)
                prefs.edit().putLong("gateway_id",state.optLong("gateway_id")).apply()
                SecretStore.put(applicationContext,"enrollment_state","connected")
                request(base,"POST","/api/gateway/enrollment/claimed",issued,JSONObject())
                SecretStore.remove(applicationContext,"enrollment_request_id")
                SecretStore.remove(applicationContext,"enrollment_poll_secret")
                SecretStore.remove(applicationContext,"enrollment_submitted")
                SecretStore.remove(applicationContext,"enrollment_state")
                issued
            }
            "pending" -> { SecretStore.put(applicationContext,"enrollment_state","pending");null }
            "rejected","expired" -> { SecretStore.put(applicationContext,"enrollment_state",state.optString("status"));null }
            else -> throw IllegalStateException("Unexpected enrollment status")
        }
    }

    private fun request(base:String,method:String,path:String,token:String?,body:JSONObject?):JSONObject {
        val connection=URL(base+path).openConnection() as HttpURLConnection
        connection.requestMethod=method;connection.connectTimeout=15000;connection.readTimeout=15000
        connection.setRequestProperty("Accept","application/json")
        if(token!=null)connection.setRequestProperty("Authorization","Bearer $token")
        if(body!=null){connection.doOutput=true;connection.setRequestProperty("Content-Type","application/json");connection.outputStream.use{it.write(body.toString().toByteArray())}}
        val code=connection.responseCode
        val stream=if(code<400)connection.inputStream else connection.errorStream
        val text=stream?.bufferedReader()?.use{it.readText()}?:"{}"
        connection.disconnect()
        if(code>=400)throw IllegalStateException("API $code: $text")
        return JSONObject(text)
    }

    companion object {
        fun enqueue(ctx:Context) {
            val req=androidx.work.OneTimeWorkRequestBuilder<GatewayWorker>()
                .setConstraints(androidx.work.Constraints.Builder().setRequiredNetworkType(androidx.work.NetworkType.CONNECTED).build()).build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("gateway-sync",androidx.work.ExistingWorkPolicy.APPEND_OR_REPLACE,req)
        }
        fun pair(ctx:Context)=enqueue(ctx)
        fun enqueueDelayed(ctx:Context,seconds:Long) {
            val req=androidx.work.OneTimeWorkRequestBuilder<GatewayWorker>().setInitialDelay(seconds.coerceAtLeast(30),TimeUnit.SECONDS)
                .setConstraints(androidx.work.Constraints.Builder().setRequiredNetworkType(androidx.work.NetworkType.CONNECTED).build()).build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("gateway-followup",androidx.work.ExistingWorkPolicy.APPEND_OR_REPLACE,req)
        }
    }
}
