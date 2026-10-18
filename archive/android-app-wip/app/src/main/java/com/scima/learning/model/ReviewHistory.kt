package com.scima.learning.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "review_history")
data class ReviewHistory(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val date: String, // ISO date string (YYYY-MM-DD)
    val total: Int = 0,
    val correct: Int = 0,
    val deckId: Long? = null
)
