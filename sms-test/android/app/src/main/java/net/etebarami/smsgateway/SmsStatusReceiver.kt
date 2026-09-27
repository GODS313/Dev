package net.etebarami.smsgateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class SmsStatusReceiver:BroadcastReceiver(){
    override fun onReceive(context:Context,intent:Intent){
        val id=intent.getLongExtra("job_id",-1);if(id<0)return
        val action=intent.action?:return;val code=resultCode
        val event=if(action.endsWith("DELIVERED")){if(code!=android.app.Activity.RESULT_OK)return;"delivered"}else if(code==android.app.Activity.RESULT_OK)"sent" else "failed"
        val detail=if(event=="failed")"SmsManager resultCode=$code" else null
        // Persist before attempting network I/O; the constrained worker syncs after reconnection.
        ReportQueue.add(context.applicationContext,id,event,detail)
    }
}
