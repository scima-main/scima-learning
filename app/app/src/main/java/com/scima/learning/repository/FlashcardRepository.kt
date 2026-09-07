package com.scima.learning.repository

import android.content.Context
import com.scima.learning.data.FlashcardDao
import com.scima.learning.database.AppDatabase
import com.scima.learning.model.CardState
import com.scima.learning.model.Flashcard
import kotlinx.coroutines.flow.Flow

class FlashcardRepository(context: Context) {
    private val database = AppDatabase.getDatabase(context)
    private val flashcardDao = database.flashcardDao()

    fun getCardsByDeck(deckId: Long): Flow<List<Flashcard>> = flashcardDao.getCardsByDeck(deckId)
    
    suspend fun getCardById(id: Long): Flashcard? = flashcardDao.getCardById(id)
    
    suspend fun insertCard(card: Flashcard): Long = flashcardDao.insertCard(card)
    
    suspend fun updateCard(card: Flashcard) = flashcardDao.updateCard(card)
    
    suspend fun deleteCard(card: Flashcard) = flashcardDao.deleteCard(card)
    
    suspend fun getStudyQueue(deckId: Long, limit: Int = 20): List<Flashcard> = 
        flashcardDao.getStudyQueue(deckId, System.currentTimeMillis(), limit)
    
    suspend fun updateCardSRS(
        id: Long,
        ease: Double,
        interval: Int,
        reps: Int,
        lapses: Int,
        state: CardState,
        nextReview: Long
    ) = flashcardDao.updateCardSRS(id, ease, interval, reps, lapses, state, nextReview)
}
