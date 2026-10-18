package com.scima.learning.database

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import com.scima.learning.data.DeckDao
import com.scima.learning.data.FlashcardDao
import com.scima.learning.model.Deck
import com.scima.learning.model.Flashcard

@Database(entities = [Deck::class, Flashcard::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun deckDao(): DeckDao
    abstract fun flashcardDao(): FlashcardDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getDatabase(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "scima_learning_database"
                ).build()
                INSTANCE = instance
                instance
            }
        }
    }
}
