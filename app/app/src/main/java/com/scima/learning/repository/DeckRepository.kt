package com.scima.learning.repository

import android.content.Context
import com.scima.learning.data.DeckDao
import com.scima.learning.data.FlashcardDao
import com.scima.learning.database.AppDatabase
import com.scima.learning.model.Deck
import com.scima.learning.model.Flashcard
import kotlinx.coroutines.flow.Flow

class DeckRepository(context: Context) {
    private val database = AppDatabase.getDatabase(context)
    private val deckDao = database.deckDao()
    private val flashcardDao = database.flashcardDao()

    val allDecks: Flow<List<Deck>> = deckDao.getAllDecks()

    fun getDecksBySubject(subject: String): Flow<List<Deck>> = deckDao.getDecksBySubject(subject)
    
    suspend fun getDeckById(id: Long): Deck? = deckDao.getDeckById(id)
    
    suspend fun insertDeck(deck: Deck): Long = deckDao.insertDeck(deck)
    
    suspend fun updateDeck(deck: Deck) = deckDao.updateDeck(deck)
    
    suspend fun deleteDeck(deck: Deck) = deckDao.deleteDeck(deck)
    
    suspend fun getCardCount(deckId: Long): Int = flashcardDao.getCardCount(deckId)
    
    suspend fun getDueCount(deckId: Long): Int = flashcardDao.getDueCount(deckId)
}
