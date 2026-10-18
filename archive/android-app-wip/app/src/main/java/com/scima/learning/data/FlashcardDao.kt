package com.scima.learning.data

import androidx.room.*
import com.scima.learning.model.Flashcard
import kotlinx.coroutines.flow.Flow

@Dao
interface FlashcardDao {
    @Query("SELECT * FROM cards WHERE deckId = :deckId ORDER BY createdAt")
    fun getCardsByDeck(deckId: Long): Flow<List<Flashcard>>
    
    @Query("SELECT * FROM cards WHERE id = :id")
    suspend fun getCardById(id: Long): Flashcard?
    
    @Query("""
        SELECT * FROM cards 
        WHERE deckId IN (SELECT id FROM decks WHERE subject = :subject)
        AND state != 'NEW'
        AND nextReviewAt <= :now
        ORDER BY nextReviewAt ASC
    """)
    fun getDueCardsBySubject(subject: String, now: Long = System.currentTimeMillis()): Flow<List<Flashcard>>
    
    @Query("""
        SELECT * FROM cards 
        WHERE deckId = :deckId 
        AND (state = 'NEW' OR nextReviewAt <= :now)
        ORDER BY 
            CASE WHEN state = 'NEW' THEN 0 ELSE 1 END,
            nextReviewAt ASC
        LIMIT :limit
    """)
    suspend fun getStudyQueue(deckId: Long, now: Long = System.currentTimeMillis(), limit: Int = 20): List<Flashcard>
    
    @Query("SELECT * FROM cards WHERE state = 'NEW' AND deckId = :deckId ORDER BY createdAt LIMIT :limit")
    suspend fun getNewCards(deckId: Long, limit: Int = 10): List<Flashcard>
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCard(card: Flashcard): Long
    
    @Update
    suspend fun updateCard(card: Flashcard)
    
    @Delete
    suspend fun deleteCard(card: Flashcard)
    
    @Query("UPDATE cards SET lastReviewedAt = :timestamp, easeFactor = :ease, interval = :interval, repetitions = :reps, lapses = :lapses, state = :state, nextReviewAt = :nextReview WHERE id = :id")
    suspend fun updateCardSRS(
        id: Long,
        ease: Double,
        interval: Int,
        reps: Int,
        lapses: Int,
        state: com.scima.learning.model.CardState,
        nextReview: Long,
        timestamp: Long = System.currentTimeMillis()
    )
    
    @Query("SELECT COUNT(*) FROM cards WHERE deckId = :deckId")
    suspend fun getCardCount(deckId: Long): Int
    
    @Query("SELECT COUNT(*) FROM cards WHERE deckId = :deckId AND state != 'NEW' AND nextReviewAt <= :now")
    suspend fun getDueCount(deckId: Long, now: Long = System.currentTimeMillis()): Int
}
