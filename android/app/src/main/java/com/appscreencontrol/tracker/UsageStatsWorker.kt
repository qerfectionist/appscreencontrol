package com.appscreencontrol.tracker

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.util.Log
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

class UsageStatsWorker(
    private val context: Context,
    workerParams: WorkerParameters
) : Worker(context, workerParams) {

    override fun doWork(): Result {
        try {
            val usageStatsManager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager

            val calendar = Calendar.getInstance()
            calendar.set(Calendar.HOUR_OF_DAY, 0)
            calendar.set(Calendar.MINUTE, 0)
            calendar.set(Calendar.SECOND, 0)
            calendar.set(Calendar.MILLISECOND, 0)
            val startTime = calendar.timeInMillis
            val endTime = System.currentTimeMillis()

            // Calculate precise app durations using Android UsageEvents (used by Digital Wellbeing)
            val usageEvents = usageStatsManager.queryEvents(startTime, endTime)
            val event = UsageEvents.Event()
            val appTimeMap = mutableMapOf<String, Long>()
            val appStartMap = mutableMapOf<String, Long>()

            while (usageEvents.hasNextEvent()) {
                usageEvents.getNextEvent(event)
                val pkg = event.packageName ?: continue

                if (isUserApp(pkg)) {
                    if (event.eventType == UsageEvents.Event.ACTIVITY_RESUMED || event.eventType == 1) {
                        appStartMap[pkg] = event.timeStamp
                    } else if (event.eventType == UsageEvents.Event.ACTIVITY_PAUSED || event.eventType == 2) {
                        val start = appStartMap[pkg]
                        if (start != null && start > 0) {
                            val diffSecs = (event.timeStamp - start) / 1000
                            if (diffSecs > 0 && diffSecs < 86400) {
                                appTimeMap[pkg] = (appTimeMap[pkg] ?: 0L) + diffSecs
                            }
                            appStartMap.remove(pkg)
                        }
                    }
                }
            }

            // Fallback for currently active foreground app
            for ((pkg, start) in appStartMap) {
                val currentDiff = (endTime - start) / 1000
                if (currentDiff > 0 && currentDiff < 86400) {
                    appTimeMap[pkg] = (appTimeMap[pkg] ?: 0L) + currentDiff
                }
            }

            // If UsageEvents returned empty, fallback to queryUsageStats
            if (appTimeMap.isEmpty()) {
                val stats = usageStatsManager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, startTime, endTime)
                if (stats != null) {
                    for (u in stats) {
                        val secs = u.totalTimeInForeground / 1000
                        if (secs > 5 && isUserApp(u.packageName)) {
                            appTimeMap[u.packageName] = secs
                        }
                    }
                }
            }

            val appArray = JSONArray()
            var totalSeconds = 0L

            for ((pkg, secs) in appTimeMap) {
                if (secs >= 5) { // Log any app used for 5+ seconds
                    val appObj = JSONObject().apply {
                        put("packageName", pkg)
                        put("label", getAppLabel(pkg))
                        put("seconds", secs)
                        put("category", getCategory(pkg))
                    }
                    appArray.put(appObj)
                    totalSeconds += secs
                }
            }

            val payload = JSONObject().apply {
                put("deviceId", NetworkManager.getDeviceId(context))
                put("apps", appArray)
                put("totalScreenTimeSeconds", totalSeconds)
            }

            NetworkManager.sendPost(context, "/api/track/usage", payload)
            Log.d("UsageStatsWorker", "Ultra-precise usage reported for ${appArray.length()} apps. Total: $totalSeconds sec")

            return Result.success()
        } catch (e: Exception) {
            Log.e("UsageStatsWorker", "Error in UsageStatsWorker", e)
            return Result.failure()
        }
    }

    private fun isUserApp(pkg: String): Boolean {
        return !pkg.startsWith("com.android.systemui") &&
                !pkg.startsWith("com.google.android.inputmethod") &&
                !pkg.contains("launcher") &&
                !pkg.contains("android.settings")
    }

    private fun getAppLabel(pkg: String): String {
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

    private fun getCategory(pkg: String): String {
        return when {
            pkg.contains("youtube") || pkg.contains("tiktok") -> "Media"
            pkg.contains("chrome") -> "Browsing"
            pkg.contains("freefire") || pkg.contains("brawl") || pkg.contains("roblox") -> "Games"
            pkg.contains("duolingo") -> "Education"
            pkg.contains("instagram") || pkg.contains("telegram") || pkg.contains("vk") -> "Social"
            else -> "Other"
        }
    }
}
