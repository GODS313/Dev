package net.etebarami.smsgateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.widget.Toast

class SmsStatusReceiver:BroadcastReceiver(){
    override fun onReceive(context:Context,intent:Intent){
        val id=intent.getLongExtra("job_id",-1);if(id<0)return
        val action=intent.action?:return;val code=resultCode
        val event=if(action.endsWith("DELIVERED")){if(code!=android.app.Activity.RESULT_OK)return;"delivered"}else if(code==android.app.Activity.RESULT_OK)"sent" else "failed"
        val detail=if(event=="failed")"SmsManager resultCode=$code" else null
        if (intent.getBooleanExtra("local_only", false)) {
            val message = when (event) { "sent" -> "پیام به شبکهٔ اپراتور تحویل شد."; "delivered" -> "تحویل پیام تأیید شد."; else -> "ارسال SMS ناموفق بود (کد $code)." }
            context.getSharedPreferences("local_sms", Context.MODE_PRIVATE).edit().putLong("last_job", id).putString("last_status", event).putString("last_detail", message).apply()
            Handler(Looper.getMainLooper()).post { Toast.makeText(context.applicationContext, message, Toast.LENGTH_LONG).show() }
            return
        }
        // Persist before attempting network I/O; the constrained worker syncs after reconnection.
        ReportQueue.add(context.applicationContext,id,event,detail)
    }
}
