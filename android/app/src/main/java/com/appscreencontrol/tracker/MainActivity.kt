package com.appscreencontrol.tracker

import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.TextUtils
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.appscreencontrol.tracker.databinding.ActivityMainBinding
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Always start the 24/7 un-killable background service
        ForegroundTrackerService.startService(this)

        initUI()
    }

    override fun onResume() {
        super.onResume()
        checkPermissionsStatus()
    }

    private fun initUI() {
        // Load saved server URL
        binding.etServerUrl.setText(NetworkManager.getServerUrl(this))

        // Device Selection
        val savedId = NetworkManager.getDeviceId(this)
        if (savedId == "sister") {
            binding.rbSister.isChecked = true
        } else {
            binding.rbBrother.isChecked = true
        }

        // Quick Update Button
        binding.btnCheckUpdate.setOnClickListener {
            val url = binding.etServerUrl.text.toString().trim()
            if (url.isNotEmpty()) {
                NetworkManager.setServerUrl(this, url)
            }
            Toast.makeText(this, "🔄 Проверка и скачивание обновления...", Toast.LENGTH_SHORT).show()
            AutoUpdater.checkForUpdatesAsync(this)
        }

        // Grant Usage Access Button
        binding.btnGrantUsage.setOnClickListener {
            startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
        }

        // Grant Accessibility Service Button
        binding.btnGrantAccessibility.setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }

        // Grant Battery Optimization Ignore Button
        binding.btnGrantBatteryOpt.setOnClickListener {
            requestIgnoreBatteryOptimization()
        }

        // Save & Start Button
        binding.btnSaveAndStart.setOnClickListener {
            val url = binding.etServerUrl.text.toString().trim()
            if (url.isEmpty()) {
                Toast.makeText(this, "Введите адрес сервера!", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            val ownerId = if (binding.rbSister.isChecked) "sister" else "brother"
            val ownerName = if (binding.rbSister.isChecked) "Сестренка" else "Брат"

            NetworkManager.setServerUrl(this, url)
            NetworkManager.setDeviceId(this, ownerId)

            // Start 24/7 Persistent Foreground Service
            ForegroundTrackerService.startService(this)

            // Send Heartbeat Ping
            val heartbeat = JSONObject().apply {
                put("deviceId", ownerId)
                put("name", ownerName)
                put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
                put("battery", getBatteryLevel())
                put("currentApp", "Настройки AppScreenControl")
            }
            NetworkManager.sendPost(this, "/api/heartbeat", heartbeat)

            // Trigger immediate usage stats sync right away!
            triggerImmediateUsageSync()

            // Schedule Background Worker (every 15 min)
            scheduleUsageWorker()

            Toast.makeText(this, "✅ Трекер работает 24/7 в фоновом режиме!", Toast.LENGTH_LONG).show()
        }

        checkPermissionsStatus()
    }

    private fun requestIgnoreBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            intent.data = Uri.parse("package:$packageName")
            try {
                startActivity(intent)
            } catch (e: Exception) {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }
        }
    }

    private fun checkPermissionsStatus() {
        // Usage Access
        val hasUsage = hasUsageAccessPermission()
        if (hasUsage) {
            binding.tvUsageStatus.text = "✅ Доступ к статистике: Разрешено"
            binding.tvUsageStatus.setTextColor(0xFF10B981.toInt())
            binding.btnGrantUsage.isEnabled = false
        } else {
            binding.tvUsageStatus.text = "❌ Доступ к статистике: Не выдано"
            binding.tvUsageStatus.setTextColor(0xFFCBD5E1.toInt())
            binding.btnGrantUsage.isEnabled = true
        }

        // Accessibility Service
        val hasAccessibility = isAccessibilityServiceEnabled()
        if (hasAccessibility) {
            binding.tvAccessibilityStatus.text = "✅ Служба спец. возможностей: Включена"
            binding.tvAccessibilityStatus.setTextColor(0xFF10B981.toInt())
            binding.btnGrantAccessibility.isEnabled = false
        } else {
            binding.tvAccessibilityStatus.text = "❌ Служба спец. возможностей: Выключена"
            binding.tvAccessibilityStatus.setTextColor(0xFFCBD5E1.toInt())
            binding.btnGrantAccessibility.isEnabled = true
        }

        // Battery Optimization Ignore Status
        val isBatteryOptIgnored = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            pm.isIgnoringBatteryOptimizations(packageName)
        } else true

        if (isBatteryOptIgnored) {
            binding.tvBatteryOptStatus.text = "✅ Фоновая работа: Без ограничений 24/7"
            binding.tvBatteryOptStatus.setTextColor(0xFF10B981.toInt())
            binding.btnGrantBatteryOpt.isEnabled = false
        } else {
            binding.tvBatteryOptStatus.text = "⚠️ Фоновая работа: Ограничена системой"
            binding.tvBatteryOptStatus.setTextColor(0xFFF59E0B.toInt())
            binding.btnGrantBatteryOpt.isEnabled = true
        }
    }

    private fun hasUsageAccessPermission(): Boolean {
        val appOps = getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(),
                packageName
            )
        } else {
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(),
                packageName
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val serviceName = "$packageName/${ScreenTrackerAccessibilityService::class.java.canonicalName}"
        val enabledServices = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        val colonSplitter = TextUtils.SimpleStringSplitter(':')
        colonSplitter.setString(enabledServices)
        while (colonSplitter.hasNext()) {
            val componentName = colonSplitter.next()
            if (componentName.equals(serviceName, ignoreCase = true)) {
                return true
            }
        }
        return false
    }

    private fun getBatteryLevel(): Int {
        val bm = getSystemService(Context.BATTERY_SERVICE) as android.os.BatteryManager
        return bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)
    }

    private fun triggerImmediateUsageSync() {
        val workRequest = OneTimeWorkRequestBuilder<UsageStatsWorker>().build()
        WorkManager.getInstance(this).enqueue(workRequest)
    }

    private fun scheduleUsageWorker() {
        val workRequest = PeriodicWorkRequestBuilder<UsageStatsWorker>(15, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "AppScreenControlUsageSync",
            ExistingPeriodicWorkPolicy.KEEP,
            workRequest
        )
    }
}
