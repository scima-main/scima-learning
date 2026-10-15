package com.scima.learning.repository

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import com.scima.learning.model.ApiSettings
import com.google.gson.Gson

class SettingsRepository(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("scima_settings", Context.MODE_PRIVATE)
    private val gson = Gson()

    companion object {
        private const val KEY_API_SETTINGS = "api_settings"
        private const val KEY_THEME = "theme"
        private const val KEY_NOTIFICATIONS = "notifications_enabled"
        private const val KEY_DAILY_GOAL = "daily_goal"
    }

    fun getApiSettings(): ApiSettings {
        val json = prefs.getString(KEY_API_SETTINGS, null)
        return if (json != null) {
            gson.fromJson(json, ApiSettings::class.java)
        } else {
            ApiSettings()
        }
    }

    fun saveApiSettings(settings: ApiSettings) {
        val json = gson.toJson(settings)
        prefs.edit { putString(KEY_API_SETTINGS, json) }
    }

    fun getTheme(): String {
        return prefs.getString(KEY_THEME, "system") ?: "system"
    }

    fun setTheme(theme: String) {
        prefs.edit { putString(KEY_THEME, theme) }
    }

    fun isNotificationsEnabled(): Boolean {
        return prefs.getBoolean(KEY_NOTIFICATIONS, true)
    }

    fun setNotificationsEnabled(enabled: Boolean) {
        prefs.edit { putBoolean(KEY_NOTIFICATIONS, enabled) }
    }

    fun getDailyGoal(): Int {
        return prefs.getInt(KEY_DAILY_GOAL, 20)
    }

    fun setDailyGoal(goal: Int) {
        prefs.edit { putInt(KEY_DAILY_GOAL, goal) }
    }
}
