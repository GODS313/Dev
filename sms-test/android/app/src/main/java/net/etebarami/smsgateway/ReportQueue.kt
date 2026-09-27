package net.etebarami.smsgateway

import android.content.Context
import androidx.work.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object ReportQueue {
    private const val prefsName="gateway_result_queue"
    fun add(ctx:Context,id:Long,event:String,error:String?=null) {
        val prefs=ctx.getSharedPreferences(prefsName,Context.MODE_PRIVATE);val old=prefs.getString("items","[]")?:"[]";val items=try{JSONArray(old)}catch(_:Exception){JSONArray()}
        val entry=JSONObject().put("id",id).put("event",event).put("error",error?:"");var duplicate=false
        for(i in 0 until items.length()) { val item=items.optJSONObject(i);if(item!=null&&item.optLong("id")==id&&item.optString("event")==event)duplicate=true }
        if(!duplicate)items.put(entry);prefs.edit().putString("items",items.toString()).apply();schedule(ctx)
    }
    fun schedule(ctx:Context) { val constraints=Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();val req=OneTimeWorkRequestBuilder<PendingReportWorker>().setConstraints(constraints).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build();WorkManager.getInstance(ctx).enqueueUniqueWork("sms-result-reporter",ExistingWorkPolicy.KEEP,req) }
    fun queued(ctx:Context)=ctx.getSharedPreferences(prefsName,Context.MODE_PRIVATE).getString("items","[]")!="[]"
}

class PendingReportWorker(ctx:Context,params:WorkerParameters):Worker(ctx,params) {
    override fun doWork():Result {
        val ctx=applicationContext;val prefs=ctx.getSharedPreferences("gateway_result_queue",Context.MODE_PRIVATE);val raw=prefs.getString("items","[]")?:"[]";val items=try{JSONArray(raw)}catch(_:Exception){JSONArray()};if(items.length()==0)return Result.success()
        val remaining=JSONArray();var failed=false;val base=(ctx.getSharedPreferences("gateway",Context.MODE_PRIVATE).getString("base_url","")?:"").trimEnd('/');val token=SecretStore.get(ctx,"token")
        for(i in 0 until items.length()) { val item=items.optJSONObject(i)?:continue;val id=item.optLong("id");val event=item.optString("event");try { require(base.startsWith("https://")&&token!=null);val connection=(java.net.URL("$base/api/gateway/jobs/$id/$event").openConnection() as java.net.HttpURLConnection);connection.requestMethod="POST";connection.connectTimeout=12000;connection.readTimeout=12000;connection.setRequestProperty("Authorization","Bearer $token");if(event=="failed"){connection.doOutput=true;connection.setRequestProperty("Content-Type","application/json");connection.outputStream.use{it.write(JSONObject().put("error",item.optString("error")).toString().toByteArray())}};val code=connection.responseCode;val stream=if(code<400)connection.inputStream else connection.errorStream;stream?.close();connection.disconnect();if(code>=400)throw IllegalStateException("HTTP $code") } catch(_:Exception) { remaining.put(item);failed=true } }
        prefs.edit().putString("items",remaining.toString()).apply();return if(failed)Result.retry() else Result.success()
    }
}
