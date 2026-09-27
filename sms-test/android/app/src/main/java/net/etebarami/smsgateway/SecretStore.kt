package net.etebarami.smsgateway

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object SecretStore {
    private const val alias = "ete_sms_gateway_key"
    private fun key(): SecretKey {
        val store=KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias,null) as? SecretKey)?.let { return it }
        val generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return generator.generateKey()
    }
    fun put(ctx:Context,name:String,value:String) {
        val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());val iv=cipher.iv;val encrypted=cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val packet=ByteArray(iv.size+encrypted.size);System.arraycopy(iv,0,packet,0,iv.size);System.arraycopy(encrypted,0,packet,iv.size,encrypted.size)
        ctx.getSharedPreferences("gateway_secrets",Context.MODE_PRIVATE).edit().putString(name,Base64.encodeToString(packet,Base64.NO_WRAP)).apply()
    }
    fun get(ctx:Context,name:String):String? {
        return try {
            val value=ctx.getSharedPreferences("gateway_secrets",Context.MODE_PRIVATE).getString(name,null)?:return null
            val packet=Base64.decode(value,Base64.NO_WRAP);if(packet.size<29)return null
            val iv=packet.copyOfRange(0,12);val encrypted=packet.copyOfRange(12,packet.size);val cipher=Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,iv));String(cipher.doFinal(encrypted),Charsets.UTF_8)
        } catch(_:Exception) { null }
    }
    fun remove(ctx:Context,name:String) { ctx.getSharedPreferences("gateway_secrets",Context.MODE_PRIVATE).edit().remove(name).apply() }
}
