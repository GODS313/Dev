package net.etebarami.smsgateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.SmsManager
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class SmsStatusReceiver:BroadcastReceiver(){override fun onReceive(context:Context,intent:Intent){val id=intent.getLongExtra("job_id",-1);if(id<0)return;val result=this.resultCode;val pending=goAsync();GlobalScope.launch(Dispatchers.IO){try{val event=if(intent.action?.endsWith("DELIVERED")==true)if(result==android.app.Activity.RESULT_OK)"delivered" else return@launch else if(result==android.app.Activity.RESULT_OK)"sent" else "failed";val base=intent.getStringExtra("base")?:return@launch;val token=intent.getStringExtra("token")?:return@launch;val c=URL("$base/api/gateway/jobs/$id/$event").openConnection() as HttpURLConnection;c.requestMethod="POST";c.setRequestProperty("Authorization","Bearer $token");c.setRequestProperty("Content-Type","application/json");if(event=="failed"){c.doOutput=true;c.outputStream.use{it.write(JSONObject().put("error","SmsManager resultCode=$result").toString().toByteArray())}};c.inputStream.close();c.disconnect()}catch(_:Exception){}finally{pending.finish()}}}}
