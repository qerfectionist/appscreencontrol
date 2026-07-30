package com.appscreencontrol.tracker

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class ScreenTrackerAccessibilityService : AccessibilityService() {

    private var lastPackageName: String = ""
    private var lastContentText: String = ""
    private var lastTextLogTime: Long = 0
    private var lastCheckTime: Long = 0

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return

        val packageName = event.packageName?.toString() ?: return
        if (packageName == "com.appscreencontrol.tracker" ||
            packageName.contains("launcher") ||
            packageName.contains("systemui") ||
            packageName.contains("inputmethod")) {
            return
        }

        val currentTime = System.currentTimeMillis()
        val appName = getAppNameFromPackage(packageName)
        val battery = getBatteryLevel()

        // 1. Periodic Heartbeat + Limit check + AutoUpdate (every 5 seconds)
        if (currentTime - lastCheckTime > 5000) {
            lastCheckTime = currentTime

            val heartbeatPayload = JSONObject().apply {
                put("deviceId", NetworkManager.getDeviceId(applicationContext))
                put("name", if (NetworkManager.getDeviceId(applicationContext) == "sister") "Сестренка" else "Брат")
                put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
                put("battery", battery)
                put("currentApp", appName)
            }
            NetworkManager.sendPost(applicationContext, "/api/heartbeat", heartbeatPayload)

            checkLimitsAndEnforce(appName)
            AutoUpdater.checkForUpdatesAsync(applicationContext)
        }

        // 2. App switch detection (Instant heartbeat update)
        if (packageName != lastPackageName) {
            lastPackageName = packageName

            val payload = JSONObject().apply {
                put("deviceId", NetworkManager.getDeviceId(applicationContext))
                put("app", appName)
                put("content", "Запущено приложение: $appName")
                put("type", "app")
            }

            Log.d("ScreenTracker", "App switched to: $appName (Battery: $battery%)")
            NetworkManager.sendPost(applicationContext, "/api/track/content", payload)
        }

        // 3. Capture video titles / search queries / screen text
        if (currentTime - lastTextLogTime > 2000) {
            val rootNode = rootInActiveWindow ?: return
            val extractedText = extractScreenText(rootNode)

            if (extractedText.isNotBlank() && extractedText != lastContentText) {
                lastContentText = extractedText
                lastTextLogTime = currentTime

                val type = when {
                    packageName.contains("youtube") -> "video"
                    packageName.contains("chrome") || packageName.contains("browser") -> "search"
                    packageName.contains("tiktok") -> "video"
                    packageName.contains("instagram") -> "social"
                    else -> "activity"
                }

                val prefix = when (type) {
                    "video" -> "Смотрит: "
                    "search" -> "Искал: "
                    "social" -> "Просмотр: "
                    else -> "На экране: "
                }

                val payload = JSONObject().apply {
                    put("deviceId", NetworkManager.getDeviceId(applicationContext))
                    put("app", appName)
                    put("content", "$prefix$extractedText")
                    put("type", type)
                }

                Log.d("ScreenTracker", "Captured text in $appName: $extractedText")
                NetworkManager.sendPost(applicationContext, "/api/track/content", payload)
            }
        }
    }

    private fun getBatteryLevel(): Int {
        return try {
            val bm = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        } catch (e: Exception) {
            100
        }
    }

    private fun checkLimitsAndEnforce(currentAppName: String) {
        Thread {
            try {
                val baseUrl = NetworkManager.getServerUrl(applicationContext)
                val deviceId = NetworkManager.getDeviceId(applicationContext)
                val url = URL("$baseUrl/api/child/config?deviceId=$deviceId")

                val conn = url.openConnection() as HttpURLConnection
                conn.connectTimeout = 3000
                conn.readTimeout = 3000
                conn.requestMethod = "GET"

                if (conn.responseCode == 200) {
                    val stream = conn.inputStream
                    val jsonStr = stream.bufferedReader().use { it.readText() }
                    val json = JSONObject(jsonStr)

                    val limits = json.optJSONObject("limits")
                    if (limits != null) {
                        val isLocked = limits.optBoolean("isLocked", false)
                        val maxDailySecs = limits.optLong("maxDailyTimeSeconds", 0)
                        val totalUsedSecs = json.optLong("totalScreenTimeSeconds", 0)

                        val appLimits = limits.optJSONObject("appLimits")
                        val appLimitSecs = appLimits?.optLong(currentAppName, 0) ?: 0

                        // Explicit check: Only trigger Home if isLocked IS TRUE or maxDailySecs > 0 AND exceeded!
                        if (isLocked) {
                            Log.w("ScreenTracker", "DEVICE IS LOCKED BY PARENT! Enforcing Home screen.")
                            performGlobalAction(GLOBAL_ACTION_HOME)
                        } else if (maxDailySecs > 0 && totalUsedSecs >= maxDailySecs) {
                            Log.w("ScreenTracker", "DAILY LIMIT EXCEEDED! Enforcing Home screen.")
                            performGlobalAction(GLOBAL_ACTION_HOME)
                        } else if (appLimitSecs > 0) {
                            val appsArray = json.optJSONArray("apps")
                            var appUsedSecs = 0L
                            if (appsArray != null) {
                                for (i in 0 until appsArray.length()) {
                                    val item = appsArray.getJSONObject(i)
                                    if (item.optString("label").equals(currentAppName, ignoreCase = true)) {
                                        appUsedSecs = item.optLong("seconds", 0)
                                        break
                                    }
                                }
                            }

                            if (appUsedSecs >= appLimitSecs) {
                                Log.w("ScreenTracker", "APP LIMIT EXCEEDED for $currentAppName! Enforcing Home screen.")
                                performGlobalAction(GLOBAL_ACTION_HOME)
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e("ScreenTracker", "Limit check failed: ${e.message}")
            }
        }.start()
    }

    private fun extractScreenText(node: AccessibilityNodeInfo): String {
        val texts = mutableListOf<String>()
        collectNodeText(node, texts)

        val relevant = texts.filter { text ->
            text.length >= 4 &&
                    !text.matches(Regex("^\\d{1,2}:\\d{2}.*")) &&
                    !text.equals("Subscriptions", true) &&
                    !text.equals("Library", true) &&
                    !text.equals("Home", true) &&
                    !text.equals("Search", true) &&
                    !text.equals("Explore", true) &&
                    !text.equals("Notifications", true)
        }

        return relevant.take(2).joinToString(" • ")
    }

    private fun collectNodeText(node: AccessibilityNodeInfo?, list: MutableList<String>) {
        if (node == null) return
        val text = node.text?.toString()?.trim()
        val contentDesc = node.contentDescription?.toString()?.trim()

        if (!text.isNullOrBlank()) list.add(text)
        else if (!contentDesc.isNullOrBlank()) list.add(contentDesc)

        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            collectNodeText(child, list)
        }
    }

    private fun getAppNameFromPackage(pkg: String): String {
        return when {
            pkg.contains("youtube") -> "YouTube"
            pkg.contains("tiktok") || pkg.contains("trill") -> "TikTok"
            pkg.contains("chrome") -> "Chrome"
            pkg.contains("instagram") -> "Instagram"
            pkg.contains("freefire") -> "Free Fire"
            pkg.contains("brawlstars") -> "Brawl Stars"
            pkg.contains("duolingo") -> "Duolingo"
            pkg.contains("telegram") -> "Telegram"
            pkg.contains("vkontakte") || pkg.contains("vk") -> "VK"
            else -> pkg.split(".").lastOrNull()?.replaceFirstChar { it.uppercase() } ?: pkg
        }
    }

    override fun onInterrupt() {}
}
