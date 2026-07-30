package com.appscreencontrol.tracker

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.content.FileProvider
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

object AutoUpdater {
    private const val TAG = "AutoUpdater"
    private const val CURRENT_VERSION_CODE = 1

    fun checkForUpdatesAsync(context: Context) {
        Thread {
            try {
                val baseUrl = NetworkManager.getServerUrl(context)
                val url = "$baseUrl/api/app/version"

                val client = OkHttpClient()
                val request = Request.Builder().url(url).build()

                client.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        val body = response.body?.string() ?: return@use
                        val json = JSONObject(body)
                        val serverVersion = json.optInt("versionCode", 1)
                        val apkUrlRelative = json.optString("apkUrl", "/download/app-debug.apk")

                        if (serverVersion > CURRENT_VERSION_CODE) {
                            Log.i(TAG, "New app version found! Server: $serverVersion, Current: $CURRENT_VERSION_CODE. Downloading...")
                            downloadAndInstallApk(context, "$baseUrl$apkUrlRelative")
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Auto update check failed: ${e.message}")
            }
        }.start()
    }

    private fun downloadAndInstallApk(context: Context, downloadUrl: String) {
        try {
            val client = OkHttpClient()
            val request = Request.Builder().url(downloadUrl).build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return

                val apkFile = File(context.cacheDir, "update.apk")
                val inputStream = response.body?.byteStream() ?: return

                FileOutputStream(apkFile).use { output ->
                    inputStream.copyTo(output)
                }

                Log.i(TAG, "APK Downloaded to ${apkFile.absolutePath}. Launching installer...")
                installApk(context, apkFile)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error downloading APK update", e)
        }
    }

    private fun installApk(context: Context, file: File) {
        val intent = Intent(Intent.ACTION_VIEW)
        val apkUri: Uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                file
            )
        } else {
            Uri.fromFile(file)
        }

        intent.setDataAndType(apkUri, "application/vnd.android.package-archive")
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
        context.startActivity(intent)
    }
}
