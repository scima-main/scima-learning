package com.scima.learning.repository

import android.content.Context
import com.scima.learning.model.ApiSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class AIRepository(private val settingsRepository: SettingsRepository) {
    private val client = OkHttpClient.Builder()
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .connectTimeout(30, TimeUnit.SECONDS)
        .build()

    suspend fun generateFlashcardsFromText(text: String): List<Pair<String, String>> = withContext(Dispatchers.IO) {
        val settings = settingsRepository.getApiSettings()
        if (!settings.enabled) return@withContext emptyList()

        val prompt = """
            Based on the following text, generate 3-5 high-quality flashcards.
            Each flashcard should have a clear question (front) and answer (back).
            Return ONLY a JSON array of objects with "front" and "back" keys.
            Example: [{"front": "What is X?", "back": "X is..."}, ...]
            
            Text: $text
        """.trimIndent()

        return@withContext callLLM(prompt, settings)
    }

    suspend fun generateFlashcardsFromImageDescription(imageDescription: String): List<Pair<String, String>> = withContext(Dispatchers.IO) {
        val settings = settingsRepository.getApiSettings()
        if (!settings.enabled) return@withContext emptyList()

        val prompt = """
            Based on this image description, generate 3-5 high-quality flashcards.
            Each flashcard should have a clear question (front) and answer (back).
            Return ONLY a JSON array of objects with "front" and "back" keys.
            
            Image Description: $imageDescription
        """.trimIndent()

        return@withContext callLLM(prompt, settings)
    }

    private fun callLLM(prompt: String, settings: ApiSettings): List<Pair<String, String>> {
        return try {
            val jsonBody = JSONObject().apply {
                put("model", settings.model)
                put("messages", JSONArray().apply {
                    put(JSONObject().apply {
                        put("role", "user")
                        put("content", prompt)
                    })
                })
                put("temperature", 0.7)
                put("max_tokens", 1000)
            }

            val request = Request.Builder()
                .url("${settings.baseUrl}/v1/chat/completions")
                .post(jsonBody.toString().toRequestBody("application/json".toMediaType()))
                .addHeader("Content-Type", "application/json")
                .build()

            val response = client.newCall(request).execute()
            
            if (!response.isSuccessful) {
                return emptyList()
            }

            val responseBody = response.body?.string() ?: return emptyList()
            parseFlashcardsFromResponse(responseBody)
        } catch (e: Exception) {
            e.printStackTrace()
            emptyList()
        }
    }

    private fun parseFlashcardsFromResponse(responseJson: String): List<Pair<String, String>> {
        return try {
            val json = JSONObject(responseJson)
            val choices = json.getJSONArray("choices")
            if (choices.length() == 0) return emptyList()

            val content = choices.getJSONObject(0)
                .getJSONObject("message")
                .getString("content")

            // Parse the JSON array from the response
            val flashcardsJson = JSONArray(content.trim())
            val flashcards = mutableListOf<Pair<String, String>>()

            for (i in 0 until flashcardsJson.length()) {
                val card = flashcardsJson.getJSONObject(i)
                val front = card.optString("front", "")
                val back = card.optString("back", "")
                if (front.isNotBlank() && back.isNotBlank()) {
                    flashcards.add(Pair(front, back))
                }
            }

            flashcards
        } catch (e: Exception) {
            e.printStackTrace()
            emptyList()
        }
    }
}
