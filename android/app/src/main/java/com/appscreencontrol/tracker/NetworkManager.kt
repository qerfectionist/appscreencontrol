package com.appscreencontrol.tracker

import android.content.Context
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object NetworkManager {
    private const val TAG = "NetworkManager"
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    private const val PREFS_NAME = "tracker_prefs"
    private const val KEY_SERVER_URL = "server_url"
    private const val KEY_DEVICE_ID = "device_id"

    fun getServerUrl(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_SERVER_URL, "http://192.168.1.100:3000") ?: "http://192.168.1.100:3000"
    }

    fun setServerUrl(context: Context, url: String) {
        val cleanUrl = if (url.endsWith("/")) url.substring(0, url.length - 1) else url
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SERVER_URL, cleanUrl)
            .apply()
    }

    fun getDeviceId(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_DEVICE_ID, "brother") ?: "brother"
    }

    fun setDeviceId(context: Context, id: String) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_DEVICE_ID, id)
            .apply()
    }

    fun sendPost(context: Context, endpoint: String, jsonBody: JSONObject) {
        val baseUrl = getServerUrl(context)
        val fullUrl = "$baseUrl$endpoint"

        Thread {
            try {
                val mediaType = "application/json; charset=utf-8".toMediaType()
                val body = jsonBody.toString().toRequestBody(mediaType)
                val request = Request.Builder()
                    .url(fullUrl)
                    .post(body)
                    .build()

                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        Log.e(TAG, "Post failed to $fullUrl code: ${response.code}")
                    } else {
                        Log.d(TAG, "Post success to $fullUrl")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error sending HTTP POST to $fullUrl", e)
            }
        }.start()
    }
}
