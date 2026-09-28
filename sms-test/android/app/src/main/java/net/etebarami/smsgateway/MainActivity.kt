package net.etebarami.smsgateway

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.provider.ContactsContract
import android.telephony.PhoneNumberUtils
import android.view.Gravity
import android.view.View
import android.widget.*
import android.content.ClipData
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/** Local, user-controlled send UI. No backend pairing or activation code is needed. */
class MainActivity : AppCompatActivity() {
    private val requestPermissionsCode = 120
    private val requestContactCode = 121
    private var activeChannel: Channel? = null
    private lateinit var root: LinearLayout
    private lateinit var status: TextView
    private lateinit var phoneInput: EditText
    private lateinit var messageInput: EditText
    private lateinit var consent: CheckBox
    private lateinit var imageStatus: TextView
    private var selectedImage: Uri? = null

    private data class Channel(val name: String, val badge: String, val color: Int, val sms: Boolean)

    private val channels = listOf(
        Channel("ارسال SMS", "SMS", Color.rgb(28, 142, 92), true),
        Channel("روبیکا", "ر", Color.rgb(116, 74, 183), false),
        Channel("بله", "ب", Color.rgb(0, 145, 214), false),
        Channel("سروش پلاس", "س", Color.rgb(26, 112, 179), false)
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(246, 248, 252)
        window.navigationBarColor = Color.rgb(246, 248, 252)
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        showHome()
        askInitialPermissions()
        startExistingGatewaySync()
    }

    private fun askInitialPermissions() {
        val missing = arrayOf(Manifest.permission.READ_CONTACTS, Manifest.permission.SEND_SMS, Manifest.permission.RECEIVE_SMS)
            .filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) ActivityCompat.requestPermissions(this, missing.toTypedArray(), requestPermissionsCode)
    }

    private fun startExistingGatewaySync() {
        // Reuse only an already provisioned device token. Never create a pairing code or enroll silently.
        if (SecretStore.get(this, "token").isNullOrBlank()) return
        val prefs = getSharedPreferences("gateway", MODE_PRIVATE)
        if (prefs.getString("base_url", "").isNullOrBlank()) {
            prefs.edit().putString("base_url", "https://etebarami.net/sendo").apply()
        }
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val work = PeriodicWorkRequestBuilder<GatewayWorker>(15, TimeUnit.MINUTES).setConstraints(constraints).build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork("gateway-heartbeat", ExistingPeriodicWorkPolicy.UPDATE, work)
        GatewayWorker.enqueue(this)
    }

    override fun onRequestPermissionsResult(code: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code, permissions, results)
        if (code == requestPermissionsCode || code == requestContactCode) {
            val accepted = permissions.indices.filter { results.getOrNull(it) == PackageManager.PERMISSION_GRANTED }.map { permissions[it] }.toSet()
            status.text = when {
                Manifest.permission.RECEIVE_SMS in accepted -> "مجوز Inbox فعال شد؛ پیام‌های دریافتی پس از Sync به بات مدیر می‌رسند."
                code == requestContactCode -> "برای انتخاب مخاطب، مجوز دفترچه تلفن لازم است."
                else -> "مجوزهای لازم برای هر قابلیت را از تنظیمات گوشی تأیید کن."
            }
        }
    }

    private fun showHome() {
        activeChannel = null
        root = pageRoot()
        root.addView(label("اعتبارامی", 27f, Color.rgb(24, 34, 52), true))
        root.addView(label("ارسال از گوشی خودتان", 15f, Color.rgb(102, 113, 132)))
        root.addView(spacer(18))
        channels.forEach { channel -> root.addView(channelTile(channel)) }
        root.addView(spacer(14))
        root.addView(label("SMS از سیم‌کارت این گوشی ارسال می‌شود. برای پیام‌رسان‌ها، انتخاب گفت‌وگو و تأیید نهایی در برنامهٔ همان پیام‌رسان انجام می‌شود.", 14f, Color.rgb(92, 104, 122)))
        root.addView(spacer(12))
        root.addView(label("برای Inbox، مجوز SMS دریافتی لازم است. اگر اتصال Gateway قبلی روی گوشی باشد، بدون Pair دوباره Sync می‌شود.", 13f, Color.rgb(120, 130, 145)))
        status = label("آماده", 14f, Color.rgb(31, 113, 82))
        root.addView(status)
        setContentView(ScrollView(this).apply { isFillViewport = true; addView(root) })
    }

    private fun channelTile(channel: Channel): View {
        val tile = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = rounded(Color.WHITE, channel.color, 2, 16)
            isClickable = true
            isFocusable = true
            setOnClickListener { showComposer(channel) }
        }
        val badge = TextView(this).apply {
            text = channel.badge
            textSize = if (channel.badge.length > 2) 12f else 18f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            typeface = Typeface.DEFAULT_BOLD
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(channel.color) }
        }
        tile.addView(badge, LinearLayout.LayoutParams(dp(48), dp(48)))
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, dp(8), 0) }
        column.addView(label(channel.name, 17f, Color.rgb(30, 40, 58), true))
        column.addView(label(if (channel.sms) "ارسال با سیم‌کارت" else "باز کردن امکانات ${channel.name}", 13f, Color.rgb(112, 123, 140)))
        tile.addView(column, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        tile.addView(label("‹", 27f, channel.color, true))
        return tile
    }

    private fun showComposer(channel: Channel) {
        activeChannel = channel
        selectedImage = null
        root = pageRoot()
        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL }
        val back = Button(this).apply { text = "بازگشت"; setOnClickListener { showHome() } }
        header.addView(back)
        header.addView(label(channel.name, 22f, channel.color, true), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        root.addView(header)
        root.addView(spacer(12))

        if (channel.sms) {
            root.addView(label("گیرنده", 15f, Color.rgb(48, 59, 76), true))
            phoneInput = EditText(this).apply {
                hint = "شماره یا مخاطب انتخاب‌شده"
                setSingleLine(true)
                inputType = android.text.InputType.TYPE_CLASS_PHONE
                textDirection = View.TEXT_DIRECTION_LTR
                layoutDirection = View.LAYOUT_DIRECTION_LTR
            }
            root.addView(phoneInput, matchWidth())
            root.addView(actionButton("انتخاب از مخاطبان گوشی", channel.color) { pickContact() })
        } else {
            root.addView(label("مخاطب یا گروه را از پیشنهادهای همان پیام‌رسان یا داخل برنامه انتخاب کنید.", 15f, Color.rgb(74, 86, 104)))
            root.addView(label("انتخاب مخاطب و ارسال نهایی در پیام‌رسان انجام می‌شود تا با حساب شخصی شما باشد.", 13f, Color.rgb(105, 116, 132)))
        }

        root.addView(spacer(10))
        root.addView(label("متن پیام", 15f, Color.rgb(48, 59, 76), true))
        messageInput = EditText(this).apply {
            hint = "متن پیام را بنویسید"
            minLines = 4
            gravity = Gravity.TOP or Gravity.START
            textDirection = View.TEXT_DIRECTION_RTL
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE or android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        }
        root.addView(messageInput, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(128)))
        val counter = label("0 نویسه · حدود 1 بخش پیام", 12f, Color.rgb(115, 125, 141))
        root.addView(counter)
        messageInput.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                val text = s?.toString().orEmpty()
                val unicode = text.any { it.code > 127 }
                val perPart = if (unicode) 67 else 153
                val singlePart = if (unicode) 70 else 160
                val segments = if (text.length <= singlePart) 1 else (text.length + perPart - 1) / perPart
                counter.text = "${text.length} نویسه · ${if (unicode) "Unicode" else "GSM"} · حدود $segments بخش پیام"
            }
            override fun afterTextChanged(s: android.text.Editable?) = Unit
        })

        if (channel.sms) {
            consent = CheckBox(this).apply { text = "این گیرنده برای دریافت پیام رضایت دارد"; textSize = 14f }
            root.addView(consent)
            root.addView(actionButton("پیش‌نمایش و ارسال SMS", channel.color) { confirmSms() })
        } else {
            root.addView(actionButton("انتخاب تصویر از گالری", channel.color) { pickImage() })
            imageStatus = label("تصویری انتخاب نشده", 13f, Color.rgb(105, 116, 132))
            root.addView(imageStatus)
            root.addView(actionButton("باز کردن گزینه‌های ارسال", channel.color) { shareToMessenger() })
        }
        status = label("", 14f, Color.rgb(31, 113, 82))
        root.addView(status)
        setContentView(ScrollView(this).apply { isFillViewport = true; addView(root) })
    }

    private fun pickContact() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.READ_CONTACTS), requestContactCode)
            return
        }
        val intent = Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI)
        @Suppress("DEPRECATION")
        startActivityForResult(intent, 1)
    }

    @Deprecated("Legacy activity result API kept for Android 8 compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 2 && resultCode == RESULT_OK) {
            selectedImage = data?.data
            imageStatus.text = if (selectedImage == null) "تصویری انتخاب نشده" else "تصویر انتخاب شد و همراه متن ارسال می‌شود."
            return
        }
        if (requestCode != 1 || resultCode != RESULT_OK) return
        val uri: Uri = data?.data ?: return
        contentResolver.query(uri, arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER), null, null, null)?.use { cursor: Cursor ->
            if (cursor.moveToFirst()) phoneInput.setText(cursor.getString(0))
        }
    }

    private fun pickImage() {
        val picker = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        @Suppress("DEPRECATION")
        startActivityForResult(picker, 2)
    }

    private fun confirmSms() {
        val phone = phoneInput.text.toString().trim()
        val body = messageInput.text.toString().trim()
        if (phone.isBlank() || !PhoneNumberUtils.isGlobalPhoneNumber(phone)) { status.text = "شمارهٔ گیرنده را درست وارد یا از مخاطبان انتخاب کنید."; return }
        if (body.isBlank()) { status.text = "متن پیام خالی است."; return }
        if (!consent.isChecked) { status.text = "برای ادامه، تأیید کنید گیرنده رضایت دریافت پیام دارد."; return }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.SEND_SMS), requestPermissionsCode)
            return
        }
        android.app.AlertDialog.Builder(this)
            .setTitle("تأیید ارسال SMS")
            .setMessage("به: $phone\n\n$body\n\nارسال با سیم‌کارت انتخاب‌شده در گوشی انجام می‌شود.")
            .setNegativeButton("بازبینی", null)
            .setPositiveButton("ارسال") { _, _ ->
                try {
                    SmsSender.send(this, System.currentTimeMillis(), phone, body, localOnly = true)
                    status.text = "درخواست ارسال به سیستم گوشی سپرده شد؛ نتیجه با اعلان سیستم ثبت می‌شود."
                } catch (e: Exception) {
                    status.text = "ارسال انجام نشد: ${e.localizedMessage ?: "خطای SMS"}"
                }
            }.show()
    }

    private fun shareToMessenger() {
        val body = messageInput.text.toString().trim()
        val image = selectedImage
        if (body.isBlank() && image == null) { status.text = "متن پیام یا تصویر را انتخاب کنید."; return }
        val send = Intent(Intent.ACTION_SEND).apply {
            if (image != null) {
                type = contentResolver.getType(image) ?: "image/*"
                putExtra(Intent.EXTRA_STREAM, image)
                clipData = ClipData.newUri(contentResolver, "تصویر انتخاب‌شده", image)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } else type = "text/plain"
            if (body.isNotBlank()) putExtra(Intent.EXTRA_TEXT, body)
        }
        try {
            startActivity(Intent.createChooser(send, "انتخاب پیام‌رسان یا مخاطب"))
            status.text = "در مقصد، مخاطب یا گروه را انتخاب و ارسال را تأیید کنید."
        } catch (_: Exception) { status.text = "هیچ برنامه‌ای برای اشتراک‌گذاری متن پیدا نشد." }
    }

    private fun pageRoot() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        layoutDirection = View.LAYOUT_DIRECTION_RTL
        setPadding(dp(20), dp(20), dp(20), dp(28))
        setBackgroundColor(Color.rgb(246, 248, 252))
    }

    private fun label(textValue: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = textValue
        textSize = size
        setTextColor(color)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        gravity = Gravity.START
        setPadding(0, dp(4), 0, dp(4))
    }

    private fun actionButton(textValue: String, color: Int, action: () -> Unit) = Button(this).apply {
        text = textValue
        setTextColor(Color.WHITE)
        background = rounded(color, color, 1, 12)
        setOnClickListener { action() }
    }

    private fun matchWidth() = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
    private fun spacer(height: Int) = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(height)) }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun rounded(fill: Int, stroke: Int, strokeDp: Int, radiusDp: Int) = GradientDrawable().apply {
        setColor(fill)
        setStroke(dp(strokeDp), stroke)
        cornerRadius = dp(radiusDp).toFloat()
    }
}
