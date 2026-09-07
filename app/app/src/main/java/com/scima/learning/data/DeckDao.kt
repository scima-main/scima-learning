package com.scima.learning.data

import androidx.room.*
import com.scima.learning.model.Deck
import kotlinx.coroutines.flow.Flow

@Dao
interface DeckDao {
    @Query("SELECT * FROM decks ORDER BY pinned DESC, createdAt DESC")
    fun getAllDecks(): Flow<List<Deck>>
    
    @Query("SELECT * FROM decks WHERE id = :id")
    suspend fun getDeckById(id: Long): Deck?
    
    @Query("SELECT * FROM decks WHERE subject = :subject ORDER BY name")
    fun getDecksBySubject(subject: String): Flow<List<Deck>>
    
    @Query("SELECT * FROM decks WHERE folderId = :folderId ORDER BY name")
    fun getDecksByFolder(folderId: Long): Flow<List<Deck>>
    
    @Query("SELECT * FROM decks WHERE pinned = 1 ORDER BY name")
    fun getPinnedDecks(): Flow<List<Deck>>
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDeck(deck: Deck): Long
    
    @Update
    suspend fun updateDeck(deck: Deck)
    
    @Delete
    suspend fun deleteDeck(deck: Deck)
    
    @Query("UPDATE decks SET cardCount = (SELECT COUNT(*) FROM cards WHERE deckId = :deckId) WHERE id = :deckId")
    suspend fun updateCardCount(deckId: Long)
    
    @Query("UPDATE decks SET lastStudiedAt = :timestamp WHERE id = :deckId")
    suspend fun updateLastStudied(deckId: Long, timestamp: Long = System.currentTimeMillis())
}
