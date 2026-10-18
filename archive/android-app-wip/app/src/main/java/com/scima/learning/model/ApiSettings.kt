package com.scima.learning.model

data class ApiSettings(
    var baseUrl: String = "http://192.168.1.100:8000",
    var model: String = "local-model",
    var timeoutSeconds: Long = 60L,
    var enabled: Boolean = true
)
