package net.etebarami.smsgateway

import android.content.Context
import android.os.Build
import android.telephony.TelephonyManager
import androidx.work.CoroutineWorker
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class GatewayWorker(ctx: Context, params: WorkerParameters): CoroutineWorker(ctx,params) {
    private val prefs=ctx.getSharedPreferences("gateway",Context.MODE_PRIVATE)
    override suspend fun doWork()=withContext(Dispatchers.IO){try{var token=prefs.getString("token",null)
        if(token==null){val body=JSONObject().put("pairing_code",prefs.getString("pairing_code","")).put("device_model",Build.MANUFACTURER+" "+Build.MODEL).put("android_version",Build.VERSION.RELEASE).put("app_version","0.1.0").put("phone_number",prefs.getString("phone_number","")).put("operator",prefs.getString("operator",""));val res=request("POST","/api/gateway/pair",null,body);token=res.getString("token");prefs.edit().putString("token",token).remove("pairing_code").apply()}
        request("POST","/api/gateway/heartbeat",token,JSONObject().put("device_model",Build.MANUFACTURER+" "+Build.MODEL).put("android_version",Build.VERSION.RELEASE).put("app_version","0.1.0").put("phone_number",prefs.getString("phone_number","")).put("operator",prefs.getString("operator","")))
        val jobResponse=request("GET","/api/gateway/jobs",token,null);val jobs=jobResponse.optJSONArray("jobs")
        if(jobs!=null) for(i in 0 until jobs.length()){val job=jobs.getJSONObject(i);try{SmsSender.send(applicationContext,job.getLong("id"),job.getString("phone"),job.getString("body"),prefs.getString("base_url","")!!,token!!)}catch(e:Exception){request("POST","/api/gateway/jobs/${job.getLong("id")}/failed",token,JSONObject().put("error",e.message?:"send error"))}}
        if(jobs!=null && jobs.length()>0) enqueueDelayed(applicationContext,jobResponse.optLong("poll_after_seconds",30))
        Result.success()
    }catch(e:Exception){if(runAttemptCount<5) Result.retry() else Result.failure()}}
    private fun request(method:String,path:String,token:String?,body:JSONObject?):JSONObject {val base=prefs.getString("base_url","")?:throw Exception("Backend URL is missing");require(base.startsWith("https://")){"HTTPS is required"};val c=(URL(base+path).openConnection() as HttpURLConnection);c.requestMethod=method;c.connectTimeout=15000;c.readTimeout=15000;c.setRequestProperty("Accept","application/json");if(token!=null)c.setRequestProperty("Authorization","Bearer $token");if(body!=null){c.doOutput=true;c.setRequestProperty("Content-Type","application/json");c.outputStream.use{it.write(body.toString().toByteArray())}};val stream=if(c.responseCode<400)c.inputStream else c.errorStream;val text=stream.bufferedReader().use{it.readText()};if(c.responseCode>=400)throw Exception("API ${c.responseCode}: $text");return JSONObject(text)}
    companion object {fun enqueue(ctx:Context){val req=androidx.work.OneTimeWorkRequestBuilder<GatewayWorker>().setConstraints(androidx.work.Constraints.Builder().setRequiredNetworkType(androidx.work.NetworkType.CONNECTED).build()).build();WorkManager.getInstance(ctx).enqueueUniqueWork("gateway-sync",androidx.work.ExistingWorkPolicy.APPEND_OR_REPLACE,req)};fun pair(ctx:Context)=enqueue(ctx);fun enqueueDelayed(ctx:Context,seconds:Long){val req=androidx.work.OneTimeWorkRequestBuilder<GatewayWorker>().setInitialDelay(seconds.coerceAtLeast(30),TimeUnit.SECONDS).setConstraints(androidx.work.Constraints.Builder().setRequiredNetworkType(androidx.work.NetworkType.CONNECTED).build()).build();WorkManager.getInstance(ctx).enqueueUniqueWork("gateway-followup",androidx.work.ExistingWorkPolicy.APPEND_OR_REPLACE,req)}}
}
