package net.etebarami.smsgateway

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.telephony.SmsManager

object SmsSender {
    fun send(ctx:Context,id:Long,phone:String,body:String,localOnly:Boolean=false){
        val manager=SmsManager.getDefault(); val parts=manager.divideMessage(body)
        if(parts.size>1){val sent=ArrayList<PendingIntent>();val delivered=ArrayList<PendingIntent>();parts.indices.forEach{index->sent.add(pending(ctx,(id*100+index).toInt(), id,"SMS_SENT",localOnly));delivered.add(pending(ctx,((id xor 0x40000000L)*100+index).toInt(),id,"SMS_DELIVERED",localOnly))};manager.sendMultipartTextMessage(phone,null,parts,sent,delivered)}else manager.sendTextMessage(phone,null,body,pending(ctx,id.toInt(),id,"SMS_SENT",localOnly),pending(ctx,(id xor 0x40000000L).toInt(),id,"SMS_DELIVERED",localOnly))
    }
    private fun pending(ctx:Context,request:Int,id:Long,action:String,localOnly:Boolean):PendingIntent=PendingIntent.getBroadcast(ctx,request,Intent(ctx,SmsStatusReceiver::class.java).setAction("net.etebarami.smsgateway.$action").putExtra("job_id",id).putExtra("local_only",localOnly),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
}
