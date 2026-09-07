package com.scima.learning.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "sources")
data class Source(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val title: String,
    val author: String = "",
    val type: SourceType = SourceType.PDF,
    val filePath: String,
    val coverImage: String? = null,
    val progress: Float = 0f,
    val timeSpentSec: Int = 0,
    val createdAt: Long = System.currentTimeMillis()
)

enum class SourceType {
    PDF, EPUB, MOBI, HTML
}
