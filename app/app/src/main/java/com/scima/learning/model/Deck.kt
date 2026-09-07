package com.scima.learning.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "decks")
data class Deck(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val description: String = "",
    val emoji: String = "📚",
    val imageColor: String = "#3B82F6",
    val subject: String = "default",
    val folderId: Long? = null,
    val pinned: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
    val lastStudiedAt: Long? = null,
    val cardCount: Int = 0
)
