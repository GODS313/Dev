package net.etebarami.smsgateway

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.telephony.TelephonyManager
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.work.*
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {
    private val prefs by lazy { getSharedPreferences("gateway", MODE_PRIVATE) }
    private lateinit var status: TextView
    override fun onRequestPermissionsResult(requestCode:Int, permissions:Array<out String>, grantResults:IntArray) { super.onRequestPermissionsResult(requestCode,permissions,grantResults); if(requestCode==12 && grantResults.isNotEmpty() && grantResults[0]==PackageManager.PERMISSION_GRANTED) GatewayWorker.pair(this) else status.text="برای ارسال SMS مجوز لازم است." }
    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState)
        val box=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(36,48,36,32) }
        box.addView(TextView(this).apply { text="Etebarami SMS Gateway"; textSize=22f })
        val url=EditText(this).apply { hint="https://etebarami.net/sendo"; setText(prefs.getString("base_url","")); setSingleLine(true) }
        val code=EditText(this).apply { hint="Pairing code (8 characters)"; setText(prefs.getString("pairing_code","")); setSingleLine(true) }
        val phone=EditText(this).apply { hint="شماره سیم‌کارت (اختیاری)"; setText(prefs.getString("phone_number","")); setSingleLine(true) }
        val operator=EditText(this).apply { hint="اپراتور (مثلاً Irancell)"; setText(prefs.getString("operator","")); setSingleLine(true) }
        box.addView(url); box.addView(code); box.addView(phone); box.addView(operator)
        val pair=Button(this).apply { text="ذخیره و Pair"; setOnClickListener { val u=url.text.toString().trim().trimEnd('/'); prefs.edit().putString("base_url",u).putString("pairing_code",code.text.toString().trim()).putString("phone_number",phone.text.toString().trim()).putString("operator",operator.text.toString().trim()).apply(); if(ContextCompat.checkSelfPermission(this@MainActivity,Manifest.permission.SEND_SMS)!=PackageManager.PERMISSION_GRANTED) ActivityCompat.requestPermissions(this@MainActivity,arrayOf(Manifest.permission.SEND_SMS),12); else GatewayWorker.pair(this@MainActivity); status.text="در حال Pair شدن…" } }
        box.addView(pair)
        val sync=Button(this).apply { text="Sync now"; setOnClickListener { GatewayWorker.enqueue(this@MainActivity); status.text="Sync در صف قرار گرفت." } };box.addView(sync)
        status=TextView(this).apply { text="توکن با Android Keystore رمز می‌شود؛ گزارش‌های ارسال در قطعی اینترنت محلی صف می‌شوند."; textSize=14f };box.addView(status)
        setContentView(ScrollView(this).apply { addView(box) })
        val constraints=Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val periodic=PeriodicWorkRequestBuilder<GatewayWorker>(15,TimeUnit.MINUTES).setConstraints(constraints).build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork("gateway-heartbeat",ExistingPeriodicWorkPolicy.UPDATE,periodic)
        if(SecretStore.get(this,"token")!=null) GatewayWorker.enqueue(this);if(ReportQueue.queued(this))ReportQueue.schedule(this)
    }
}
